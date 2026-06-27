#!/usr/bin/env node
'use strict';
/*
 * cc2node repeatable test harness.
 *
 *   node test/run.js [options]
 *
 * What it does:
 *   1. Converts each requested Claude Code version with cc2node (cached under
 *      test/.cache/<version>-<platform>; re-runs are fast). "latest"/"stable"
 *      resolve to a concrete version first, so they cache correctly.
 *   2. Runs every produced build (cli.node18/20/22.js + raw cli.js) under every
 *      runnable Node major and checks `--version` prints "<version> (Claude Code)".
 *   3. Prints a build × Node compatibility matrix; exits non-zero on any failure.
 *
 * Options:
 *   --versions a,b,c   versions to test (accepts "latest"/"stable")
 *   --platform p       target platform (default: linux-x64)
 *   --nodes 18,20,...  Node majors to test (default: all runnable, from nvm + current)
 *   --this-node        only test the currently-running Node (one CI matrix job = one Node)
 *   --convert-only     convert + cache, then exit (no run matrix)
 *   --no-convert       skip conversion; test whatever is already cached for the platform
 *   --force            re-convert even if a cached output exists
 *   --quick            only the first version
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');
var resolveChannel = require('../src/download').resolveChannel;

var ROOT = path.join(__dirname, '..');
var CACHE = path.join(__dirname, '.cache');
var BIN = path.join(ROOT, 'bin', 'cc2node.js');

var BUILDS = [
  { file: 'cli.node18.js', min: 18 },
  { file: 'cli.node20.js', min: 20 },
  { file: 'cli.node22.js', min: 22 },
  { file: 'cli.js', min: 24 } // raw de-bunned: uses `using` (Node 24+)
];

function parseArgs(argv) {
  var a = {
    versions: ['2.1.185', '2.1.191', '2.1.113', '2.1.114', '2.1.126', 'latest'],
    platform: 'linux-x64',
    nodes: null,
    force: false,
    quick: false,
    convertOnly: false,
    noConvert: false,
    thisNode: false
  };
  for (var i = 0; i < argv.length; i++) {
    var x = argv[i];
    if (x === '--versions') a.versions = argv[++i].split(',').map((s) => s.trim());
    else if (x === '--platform') a.platform = argv[++i];
    else if (x === '--nodes') a.nodes = argv[++i].split(',').map((s) => parseInt(s, 10));
    else if (x === '--force') a.force = true;
    else if (x === '--quick') a.quick = true;
    else if (x === '--convert-only') a.convertOnly = true;
    else if (x === '--no-convert') a.noConvert = true;
    else if (x === '--this-node') a.thisNode = true;
  }
  if (a.quick) a.versions = a.versions.slice(0, 1);
  return a;
}

function cmpVer(a, b) {
  var pa = a.replace(/^v/, '').split('.').map(Number),
    pb = b.replace(/^v/, '').split('.').map(Number);
  for (var i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// discover installed node binaries: major -> {v, bin} (prefer nvm, include current)
function discoverNodes(wanted) {
  var found = {};
  var nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    fs.readdirSync(nvmDir).forEach((v) => {
      var m = v.match(/^v(\d+)\.(\d+)\.(\d+)/);
      if (!m) return;
      var maj = parseInt(m[1], 10);
      var bin = path.join(nvmDir, v, 'bin', 'node');
      if (!fs.existsSync(bin)) return;
      if (!found[maj] || cmpVer(v, found[maj].v) > 0) found[maj] = { v: v, bin: bin };
    });
  } catch (_e) {
    /* no nvm */
  }
  var cur = process.versions.node,
    curMaj = parseInt(cur.split('.')[0], 10);
  if (!found[curMaj]) found[curMaj] = { v: 'v' + cur, bin: process.execPath };

  var majors = Object.keys(found)
    .map(Number)
    .sort((a, b) => a - b);
  if (wanted) majors = majors.filter((m) => wanted.indexOf(m) !== -1);
  // verify each binary actually runs on this host (older macOS can't run prebuilt
  // newer Node — dyld/libc++ symbol errors). Skip the ones that don't.
  var unrunnable = [];
  majors = majors.filter((m) => {
    var r = cp.spawnSync(found[m].bin, ['--version'], { encoding: 'utf8', timeout: 20000 });
    var ok = r.status === 0 && /^v\d+\./.test((r.stdout || '').trim());
    if (!ok) unrunnable.push(found[m].v + (r.stderr ? ' (' + r.stderr.trim().split('\n')[0].slice(0, 60) + ')' : ''));
    return ok;
  });
  return { map: found, majors: majors, unrunnable: unrunnable };
}

function thisNodeOnly() {
  var cur = process.versions.node,
    maj = parseInt(cur.split('.')[0], 10);
  var map = {};
  map[maj] = { v: 'v' + cur, bin: process.execPath };
  return { map: map, majors: [maj], unrunnable: [] };
}

function listCachedVersions(platform) {
  var suffix = '-' + platform;
  try {
    return fs
      .readdirSync(CACHE)
      .filter((d) => d.slice(-suffix.length) === suffix && fs.existsSync(path.join(CACHE, d, 'cli.node22.js')))
      .map((d) => d.slice(0, d.length - suffix.length))
      .sort();
  } catch (_e) {
    return [];
  }
}

function convert(version, platform, force, noConvert) {
  var outDir = path.join(CACHE, version + '-' + platform);
  var marker = path.join(outDir, 'cli.node22.js');
  if (noConvert) return { outDir: outDir, cached: true, ok: fs.existsSync(marker) };
  if (!force && fs.existsSync(marker)) return { outDir: outDir, cached: true, ok: true };
  var local = '/tmp/cc-' + version + '.tar.gz';
  var input = fs.existsSync(local) ? local : version;
  process.stdout.write(
    '\n=== converting ' +
      version +
      ' (' +
      platform +
      ') from ' +
      (input === version ? 'downloads.claude.ai' : path.basename(input)) +
      ' ===\n'
  );
  var r = cp.spawnSync(process.execPath, [BIN, input, '--platform', platform, '--out', outDir], { stdio: 'inherit' });
  return { outDir: outDir, cached: false, ok: r.status === 0 };
}

function runBuild(nodeBin, buildPath, expectVersion) {
  var r = cp.spawnSync(nodeBin, [buildPath, '--version'], { encoding: 'utf8', timeout: 60000 });
  var out = ((r.stdout || '') + (r.stderr || '')).trim();
  var ok = r.status === 0 && out.indexOf(expectVersion + ' (Claude Code)') !== -1;
  return { ok: ok, out: out.split('\n')[0] || '', status: r.status };
}

function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

async function resolveVersions(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var real = await resolveChannel(list[i]);
    if (out.indexOf(real) === -1) out.push(real);
  }
  return out;
}

async function main() {
  var args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(CACHE, { recursive: true });

  // in --no-convert mode, test exactly what's cached (avoids re-resolving "latest")
  var versions = args.noConvert ? listCachedVersions(args.platform) : await resolveVersions(args.versions);
  if (!versions.length) {
    console.error(
      args.noConvert ? 'no cached conversions for ' + args.platform + ' in ' + CACHE : 'no versions to test'
    );
    process.exit(2);
  }

  // ---- convert-only: just build + cache ----
  if (args.convertOnly) {
    console.log('cc2node convert-only — ' + args.platform + ' — ' + versions.join(', '));
    var allOk = true;
    for (var ci = 0; ci < versions.length; ci++) {
      var c = convert(versions[ci], args.platform, args.force, false);
      console.log((c.ok ? 'OK   ' : 'FAIL ') + versions[ci] + (c.cached ? ' (cached)' : ''));
      if (!c.ok) allOk = false;
    }
    process.exit(allOk ? 0 : 1);
  }

  var nodes = args.thisNode ? thisNodeOnly() : discoverNodes(args.nodes);
  if (!nodes.majors.length) {
    console.error('no runnable Node versions found');
    process.exit(2);
  }

  console.log('cc2node test harness');
  console.log('  platform : ' + args.platform);
  console.log('  versions : ' + versions.join(', '));
  console.log('  node     : ' + nodes.majors.map((m) => nodes.map[m].v).join(', '));
  if (nodes.unrunnable?.length) {
    console.log('  skipped  : ' + nodes.unrunnable.join(', ') + '  — cannot run on this host');
  }

  var results = [];
  for (var vi = 0; vi < versions.length; vi++) {
    var version = versions[vi];
    var conv = convert(version, args.platform, args.force, args.noConvert);
    var rec = { version: version, convertOk: conv.ok, outDir: conv.outDir, cells: {} };
    if (conv.ok) {
      for (var bi = 0; bi < BUILDS.length; bi++) {
        var b = BUILDS[bi];
        var bpath = path.join(conv.outDir, b.file);
        if (!fs.existsSync(bpath)) continue;
        rec.cells[b.file] = {};
        for (var mi = 0; mi < nodes.majors.length; mi++) {
          var maj = nodes.majors[mi];
          if (maj < b.min) {
            rec.cells[b.file][maj] = { na: true };
            continue;
          }
          rec.cells[b.file][maj] = runBuild(nodes.map[maj].bin, bpath, version);
        }
      }
    }
    results.push(rec);
  }

  // ---- report ----
  var totalPass = 0,
    totalRun = 0,
    totalFail = 0;
  console.log('\n================ RESULTS ================');
  for (var ri = 0; ri < results.length; ri++) {
    var r = results[ri];
    console.log('\nClaude Code ' + r.version + (r.convertOk ? '' : '   <-- CONVERSION/CACHE MISSING'));
    if (!r.convertOk) {
      totalFail++;
      continue;
    }
    var header = '  ' + pad('build', 18);
    for (var hi = 0; hi < nodes.majors.length; hi++) header += pad('node' + nodes.majors[hi], 9);
    console.log(header);
    Object.keys(r.cells).forEach((file) => {
      var row = '  ' + pad(file, 18);
      nodes.majors.forEach((maj) => {
        var c = r.cells[file][maj],
          cell;
        if (!c) cell = '-';
        else if (c.na) cell = '·';
        else {
          totalRun++;
          if (c.ok) {
            totalPass++;
            cell = 'PASS';
          } else {
            totalFail++;
            cell = 'FAIL';
          }
        }
        row += pad(cell, 9);
      });
      console.log(row);
    });
  }
  console.log('\n=========================================');
  console.log('legend: PASS=ran & printed version  ·=N/A (build needs newer Node)  FAIL=error/wrong output');
  console.log(
    'totals: ' +
      totalPass +
      '/' +
      totalRun +
      ' runs passed; ' +
      results.filter((r) => r.convertOk).length +
      '/' +
      results.length +
      ' versions converted'
  );
  process.exit(totalFail === 0 && totalRun > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
