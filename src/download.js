'use strict';
/*
 * Obtain a Bun-compiled `claude` binary for a given version + platform.
 *
 * Sources, tried in order:
 *   1. downloads.claude.ai  — the official installer source. Has EVERY published
 *      version and platform as a raw binary, plus a manifest.json with SHA-256s.
 *   2. GitHub releases       — `claude-<platform>.tar.gz` (recent versions only).
 *   3. npm                   — `@anthropic-ai/claude-code@<version>` tarball; we
 *      scan its files for one carrying the Bun trailer.
 *
 * Pure Node (https + child_process tar), Node 18+, works on old macOS/Linux.
 */

var https = require('https');
var http = require('http');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var crypto = require('crypto');
var os = require('os');

var CLAUDE_BASE = 'https://downloads.claude.ai/claude-code-releases';
var GH_BASE = 'https://github.com/anthropics/claude-code/releases/download';

var PLATFORMS = ['linux-x64', 'linux-x64-musl', 'linux-arm64', 'linux-arm64-musl', 'darwin-x64', 'darwin-arm64'];

function hostPlatform() {
  var arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'darwin') return 'darwin-' + arch;
  // prefer musl static on Linux when we can detect it (works on old glibc too)
  if (process.platform === 'linux') {
    try {
      if (fs.existsSync('/lib/libc.musl-x86_64.so.1') || fs.existsSync('/lib/libc.musl-aarch64.so.1')) {
        return 'linux-' + arch + '-musl';
      }
    } catch (e) { /* ignore */ }
    return 'linux-' + arch;
  }
  return 'linux-' + arch;
}

// ---- low-level GET with redirects, into a file (with progress) ----
function downloadTo(url, dest, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var redirects = opts._redirects || 0;
    if (redirects > 10) return reject(new Error('too many redirects'));
    var mod = url.indexOf('https:') === 0 ? https : http;
    var req = mod.get(url, { headers: { 'user-agent': 'cc2node', accept: '*/*' } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        var next = new URL(res.headers.location, url).toString();
        return resolve(downloadTo(next, dest, Object.assign({}, opts, { _redirects: redirects + 1 })));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error('HTTP ' + res.statusCode + ' for ' + url), { statusCode: res.statusCode }));
      }
      var total = parseInt(res.headers['content-length'] || '0', 10);
      var got = 0, lastPct = -1;
      var out = fs.createWriteStream(dest);
      res.on('data', function (chunk) {
        got += chunk.length;
        if (opts.onProgress && total) {
          var pct = Math.floor((got / total) * 100);
          if (pct !== lastPct) { lastPct = pct; opts.onProgress(pct, got, total); }
        }
      });
      res.pipe(out);
      out.on('finish', function () { out.close(function () { resolve(dest); }); });
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(opts.timeout || 300000, function () { req.destroy(new Error('download timeout for ' + url)); });
  });
}

// ---- GET a small text/JSON body into memory ----
function getText(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function (resolve, reject) {
    if (redirects > 10) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'user-agent': 'cc2node', accept: '*/*' } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(getText(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error('HTTP ' + res.statusCode + ' for ' + url), { statusCode: res.statusCode }));
      }
      var d = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { d += c; });
      res.on('end', function () { resolve(d); });
    }).on('error', reject);
  });
}

function sha256(file) {
  var h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function progressBar(log) {
  return function (pct, got, total) {
    if (!process.stderr.isTTY) return;
    var mb = (got / 1048576).toFixed(1), tmb = (total / 1048576).toFixed(1);
    process.stderr.write('\r      ' + pct + '%  ' + mb + '/' + tmb + ' MB   ');
    if (pct >= 100) process.stderr.write('\r\x1b[K');
  };
}

// ---- source 1: downloads.claude.ai (raw binary + checksum) ----
function fromClaudeAi(version, platform, dest, log) {
  return getText(CLAUDE_BASE + '/' + version + '/manifest.json').then(function (body) {
    var checksum = null;
    try { checksum = (JSON.parse(body).platforms[platform] || {}).checksum || null; } catch (e) { /* ignore */ }
    var url = CLAUDE_BASE + '/' + version + '/' + platform + '/claude';
    log.info('downloads.claude.ai → ' + version + '/' + platform);
    return downloadTo(url, dest, { onProgress: progressBar(log) }).then(function () {
      if (checksum) {
        var actual = sha256(dest);
        if (actual !== checksum) throw new Error('checksum mismatch (' + actual.slice(0, 12) + '… ≠ ' + checksum.slice(0, 12) + '…)');
        log.ok('checksum verified (sha256 ' + checksum.slice(0, 12) + '…)');
      } else {
        log.warn('no checksum in manifest for ' + platform + ' — skipping verification');
      }
      return dest;
    });
  });
}

// ---- source 2: GitHub release tarball ----
function fromGitHub(version, platform, workDir, log) {
  var asset = 'claude-' + platform + '.tar.gz';
  var url = GH_BASE + '/v' + version + '/' + asset;
  var tgz = path.join(workDir, asset);
  log.info('github → ' + asset);
  return downloadTo(url, tgz, { onProgress: progressBar(log) }).then(function () {
    return extractBinaryFromTarball(tgz, workDir, log);
  });
}

// ---- source 3: npm package ----
function fromNpm(version, platform, workDir, log) {
  log.info('npm → @anthropic-ai/claude-code@' + version);
  var tarballUrl;
  try {
    tarballUrl = cp.execSync('npm view @anthropic-ai/claude-code@' + version + ' dist.tarball', { encoding: 'utf8' }).trim();
  } catch (e) {
    throw new Error('npm view failed: ' + e.message);
  }
  if (!tarballUrl) throw new Error('npm has no tarball for ' + version);
  var tgz = path.join(workDir, 'npm-claude-code-' + version + '.tgz');
  return downloadTo(tarballUrl, tgz, { onProgress: progressBar(log) }).then(function () {
    var dir = path.join(workDir, 'npm-' + version);
    fs.mkdirSync(dir, { recursive: true });
    cp.execFileSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'ignore' });
    var bin = findBunBinary(dir);
    if (!bin) throw new Error('npm package contains no Bun binary (likely a launcher-only package for this version)');
    return bin;
  });
}

// Extract a tarball and return the path to the contained Bun `claude` binary.
function extractBinaryFromTarball(tgz, workDir, log) {
  var dir = path.join(workDir, path.basename(tgz).replace(/\.(tar\.gz|tgz)$/, '') + '-x');
  fs.mkdirSync(dir, { recursive: true });
  cp.execFileSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'ignore' });
  var bin = findBunBinary(dir);
  if (!bin) throw new Error('no Bun binary found inside ' + path.basename(tgz));
  return bin;
}

// Find the file that is the Bun standalone binary: prefer a file named `claude`,
// otherwise the largest file whose tail carries the Bun trailer.
function findBunBinary(root) {
  var files = [];
  (function walk(d) {
    var ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (var i = 0; i < ents.length; i++) {
      var fp = path.join(d, ents[i].name);
      if (ents[i].isDirectory()) walk(fp);
      else { try { files.push([fp, fs.statSync(fp).size]); } catch (e) { /* ignore */ } }
    }
  })(root);
  files.sort(function (a, b) { return b[1] - a[1]; });
  var named = files.filter(function (f) { return /(^|\/)claude(\.exe)?$/.test(f[0]) && f[1] > 1e6; });
  var candidates = named.length ? named : files;
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i][1] < 1e6) continue;            // skip tiny launchers
    if (fileHasBunTrailer(candidates[i][0])) return candidates[i][0];
  }
  return null;
}

function fileHasBunTrailer(file) {
  // Scan backward in chunks (the trailer is near EOF, but macOS code-signs the
  // binary, appending ~size/128 bytes of signature AFTER the Bun trailer).
  var fd = null;
  try {
    fd = fs.openSync(file, 'r');
    var size = fs.fstatSync(fd).size;
    var needle = Buffer.from('---- Bun! ----');
    var CHUNK = 32 * 1024 * 1024, overlap = needle.length, end = size;
    while (end > 0) {
      var start = Math.max(0, end - CHUNK);
      var readEnd = Math.min(size, end + overlap);
      var len = readEnd - start;
      var b = Buffer.alloc(len);
      fs.readSync(fd, b, 0, len, start);
      if (b.indexOf(needle) !== -1) { fs.closeSync(fd); return true; }
      end = start;
    }
    fs.closeSync(fd);
    return false;
  } catch (e) { if (fd != null) try { fs.closeSync(fd); } catch (e2) {} return false; }
}

// ---- public: resolve `input` (version | tarball | binary) to a binary path ----
function obtainBinary(input, platform, workDir, log) {
  // already a local file?
  if (input && fs.existsSync(input) && fs.statSync(input).isFile()) {
    if (/\.(tar\.gz|tgz)$/.test(input)) {
      log.step('Extracting local tarball ' + path.basename(input));
      return Promise.resolve(extractBinaryFromTarball(input, workDir, log));
    }
    log.step('Using local binary ' + path.basename(input));
    if (!fileHasBunTrailer(input)) log.warn('file does not look like a Bun binary (no trailer) — trying anyway');
    return Promise.resolve(input);
  }

  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[\w.]+)?$/.test(String(input))) {
    return Promise.reject(new Error('input is neither a version (x.y.z) nor an existing file: ' + input));
  }
  var version = input;
  var dest = path.join(workDir, 'claude-' + version + '-' + platform);
  log.step('Fetching Claude Code ' + version + ' (' + platform + ')');

  return fromClaudeAi(version, platform, dest, log)
    .catch(function (e1) {
      log.warn('downloads.claude.ai failed: ' + e1.message);
      return fromGitHub(version, platform, workDir, log);
    })
    .catch(function (e2) {
      log.warn('github failed: ' + e2.message);
      return fromNpm(version, platform, workDir, log);
    });
}

module.exports = {
  obtainBinary: obtainBinary,
  hostPlatform: hostPlatform,
  PLATFORMS: PLATFORMS,
  downloadTo: downloadTo,
  getText: getText
};
