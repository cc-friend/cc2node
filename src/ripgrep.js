'use strict';
/*
 * Fetch the ripgrep (`rg`) binary the Claude Code Grep/Glob tools shell out to.
 * It is NOT embedded in the Bun binary, so we download it from ripgrep's own
 * GitHub releases for the target platform and drop it next to cli.js (the shim
 * puts the port directory on PATH so `rg` resolves out of the box).
 *
 * Linux uses the statically-linked musl build so it runs on old glibc too.
 */

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var downloadMod = require('./download');

var RG_VERSION = '14.1.1';
var RG_BASE = 'https://github.com/BurntSushi/ripgrep/releases/download';

// cc2node platform → ripgrep release triple
var TRIPLES = {
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-x64-musl': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-arm64-musl': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin'
};

async function fetchRipgrep(platform, destPath, workDir, log) {
  var triple = TRIPLES[platform];
  if (!triple) { log.warn('no ripgrep build mapped for ' + platform + ' — skipping rg'); return false; }

  var name = 'ripgrep-' + RG_VERSION + '-' + triple;
  var url = RG_BASE + '/' + RG_VERSION + '/' + name + '.tar.gz';
  var tgz = path.join(workDir, name + '.tar.gz');

  log.info('ripgrep ' + RG_VERSION + ' (' + triple + ')');
  await downloadMod.downloadTo(url, tgz, {});

  var outDir = path.join(workDir, name + '-x');
  fs.mkdirSync(outDir, { recursive: true });
  cp.execFileSync('tar', ['-xzf', tgz, '-C', outDir], { stdio: 'ignore' });

  // the binary lives at <name>/rg inside the archive
  var rg = path.join(outDir, name, 'rg');
  if (!fs.existsSync(rg)) {
    // fall back to a recursive search
    rg = findRg(outDir);
    if (!rg) throw new Error('rg binary not found inside ripgrep archive');
  }
  fs.copyFileSync(rg, destPath);
  try { fs.chmodSync(destPath, 0o755); } catch (e) { /* ignore */ }
  return true;
}

function findRg(root) {
  var stack = [root];
  while (stack.length) {
    var d = stack.pop(), ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (var i = 0; i < ents.length; i++) {
      var fp = path.join(d, ents[i].name);
      if (ents[i].isDirectory()) stack.push(fp);
      else if (ents[i].name === 'rg') return fp;
    }
  }
  return null;
}

module.exports = { fetchRipgrep: fetchRipgrep, RG_VERSION: RG_VERSION };
