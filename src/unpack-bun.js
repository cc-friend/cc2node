'use strict';
/*
 * unpack-bun: extract the embedded module graph from a Bun `--compile` standalone
 * executable (the Claude Code `claude` binary).
 *
 * Layout of the appended graph, at the very end of the executable:
 *
 *     ...[ string blob: every module name + content + sourcemap, concatenated ]...
 *     [ modules array : N fixed-size entries ]
 *     [ Offsets struct ]
 *     "\n---- Bun! ----\n"            <- trailer magic (last bytes of the file)
 *
 * Each module entry begins with two StringPointers (offset:u32, length:u32),
 * relative to a "blob base" B:
 *     name    = { off, len }     content = { off, len }
 * followed by sourcemap/bytecode pointers + loader flags we don't need.
 *
 * We don't hard-code the Bun version's struct size or B. The bundle's sourcemap
 * (which sits just before the array) is full of decoy "/$bunfs/root/..." strings,
 * so we validate hard. For each candidate entry position p in the window before
 * the trailer and each name-string offset np:
 *     B = np - readU32(p)
 * the entry is accepted only if BOTH:
 *   - the name is a clean filename ending in .js/.node/.wasm  (kills truncated /
 *     quote-bearing sourcemap fragments), and
 *   - the content it points at starts with a real module magic: "// @" (a Bun
 *     CJS module), ELF / Mach-O / PE (a native addon) or "\0asm" (wasm).
 * Survivors are grouped by B; the true base is the one whose entries form the
 * longest constant-stride run nearest the trailer — that run IS the modules array.
 *
 * Validated to reproduce the reference 2.1.185 port byte-for-byte and to work
 * across the 2.1.113 … 2.1.195 range.
 */

var TRAILER = Buffer.from('\n---- Bun! ----\n');
var NAME_PREFIXES = ['/$bunfs/root/', '/$bunfs/', 'B:/~BUN/root/', 'B:\\~BUN\\root\\'];
var ENTRY_HEAD = 16; // name(8) + content(8)
var WINDOW = 16384; // bytes before the trailer to search for the modules array

function indexOfAll(buf, needle) {
  var out = [],
    i = 0,
    nb = Buffer.from(needle);
  while ((i = buf.indexOf(nb, i)) !== -1) {
    out.push(i);
    i++;
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Does the content at `off` begin with a recognised module/file magic?
function looksLikeModuleContent(buf, off, len) {
  if (len < 4) return false;
  var b0 = buf[off],
    b1 = buf[off + 1],
    b2 = buf[off + 2],
    b3 = buf[off + 3];
  // "// @"  — Bun's "// @bun @bytecode @bun-cjs" module header
  if (b0 === 0x2f && b1 === 0x2f && b2 === 0x20 && b3 === 0x40) return true;
  // ELF (Linux native addon / rg)
  if (b0 === 0x7f && b1 === 0x45 && b2 === 0x4c && b3 === 0x46) return true;
  // Mach-O (darwin native addon): 32/64-bit LE+BE and universal (fat)
  var be = ((b0 << 24) >>> 0) + (b1 << 16) + (b2 << 8) + b3;
  if (
    be === 0xcffaedfe ||
    be === 0xfeedfacf ||
    be === 0xcefaedfe ||
    be === 0xfeedface ||
    be === 0xcafebabe ||
    be === 0xcafebabf ||
    be === 0xbebafeca ||
    be === 0xbfbafeca
  )
    return true;
  // WASM "\0asm"
  if (b0 === 0x00 && b1 === 0x61 && b2 === 0x73 && b3 === 0x6d) return true;
  // PE "MZ" (Windows native addon)
  if (b0 === 0x4d && b1 === 0x5a) return true;
  return false;
}

function longestStrideRun(entries) {
  if (entries.length <= 2) return entries.slice();
  var freq = {};
  for (var d = 1; d < entries.length; d++) {
    var diff = entries[d].p - entries[d - 1].p;
    freq[diff] = (freq[diff] || 0) + 1;
  }
  var stride = null,
    sBest = -1;
  Object.keys(freq).forEach((key) => {
    if (freq[key] > sBest) {
      sBest = freq[key];
      stride = parseInt(key, 10);
    }
  });
  var best = [entries[0]],
    cur = [entries[0]];
  for (var r = 1; r < entries.length; r++) {
    if (entries[r].p - entries[r - 1].p === stride) cur.push(entries[r]);
    else {
      if (cur.length > best.length) best = cur;
      cur = [entries[r]];
    }
  }
  if (cur.length > best.length) best = cur;
  return best;
}

function unpackBun(buf) {
  var fileLen = buf.length;
  var trailerAt = buf.lastIndexOf(TRAILER);
  if (trailerAt < 0) {
    throw new Error('not a Bun-compiled binary: "---- Bun! ----" trailer not found');
  }

  // 1) candidate name-string positions (pick the first virtual-fs scheme that hits)
  var namePos = [],
    prefix = null;
  for (var pi = 0; pi < NAME_PREFIXES.length; pi++) {
    var hits = indexOfAll(buf, NAME_PREFIXES[pi]);
    if (hits.length) {
      namePos = hits;
      prefix = NAME_PREFIXES[pi];
      break;
    }
  }
  if (!namePos.length) {
    throw new Error('could not locate embedded module names (no /$bunfs/ paths)');
  }
  var NAME_OK = new RegExp('^' + escapeRe(prefix) + '[A-Za-z0-9_./@+-]+\\.(js|cjs|mjs|node|wasm)$');

  // 2) gather strictly-valid entries (name magic + content magic), grouped by base B
  var windowStart = Math.max(0, trailerAt - WINDOW);
  var byBase = new Map();
  for (var p = windowStart; p <= trailerAt - ENTRY_HEAD; p++) {
    var nameLen = buf.readUInt32LE(p + 4);
    if (nameLen < 3 || nameLen > 4096) continue;
    var nameOff = buf.readUInt32LE(p);
    for (var k = 0; k < namePos.length; k++) {
      var np = namePos[k];
      var B = np - nameOff;
      if (B < 0 || B > fileLen) continue;
      if (np + nameLen > fileLen) continue;
      var name = buf.toString('latin1', np, np + nameLen);
      if (!NAME_OK.test(name)) continue;
      var contOff = buf.readUInt32LE(p + 8),
        contLen = buf.readUInt32LE(p + 12);
      var contAbs = B + contOff;
      if (contLen <= 0 || contAbs < 0 || contAbs + contLen > fileLen) continue;
      if (!looksLikeModuleContent(buf, contAbs, contLen)) continue;
      var list = byBase.get(B);
      if (!list) {
        list = [];
        byBase.set(B, list);
      }
      list.push({ p: p, name: name, contentAbs: contAbs, contentLen: contLen });
    }
  }
  if (!byBase.size) throw new Error('no module entries decoded (unrecognised Bun graph layout)');

  // 3) pick the base whose entries form the longest constant-stride run; tie-break
  //    on proximity to the trailer (the real array sits right before it).
  var base = null,
    modulesEntries = null,
    bestLen = -1,
    bestMaxP = -1;
  byBase.forEach((list, B) => {
    var seen = {},
      distinct = [];
    for (var i = 0; i < list.length; i++)
      if (!seen[list[i].p]) {
        seen[list[i].p] = 1;
        distinct.push(list[i]);
      }
    distinct.sort((a, b) => a.p - b.p);
    var run = longestStrideRun(distinct);
    var maxP = run[run.length - 1].p;
    if (run.length > bestLen || (run.length === bestLen && maxP > bestMaxP)) {
      bestLen = run.length;
      bestMaxP = maxP;
      base = B;
      modulesEntries = run;
    }
  });

  // 4) materialise modules
  var mods = modulesEntries.map((e) => ({
    name: e.name,
    basename: e.name.replace(/^.*\//, ''),
    content: buf.subarray(e.contentAbs, e.contentAbs + e.contentLen)
  }));

  // entry module = the bundled cli.js (fallback: largest .js)
  var entry = mods.find((m) => /(^|\/)cli\.js$/.test(m.name));
  if (!entry) {
    entry = mods.filter((m) => /\.(c|m)?js$/.test(m.name)).sort((a, b) => b.content.length - a.content.length)[0];
  }
  if (!entry) throw new Error('could not identify the cli.js entry module');

  // 5) sniff the version from the bundle ("// Version: x.y.z")
  var head = entry.content.toString('utf8', 0, Math.min(entry.content.length, 8192));
  var vm = head.match(/\/\/ Version:\s*([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?)/);

  return {
    base: base,
    trailerAt: trailerAt,
    prefix: prefix,
    entryCount: mods.length,
    modules: mods,
    entry: entry,
    version: vm ? vm[1] : null
  };
}

module.exports = { unpackBun: unpackBun, TRAILER: TRAILER };
