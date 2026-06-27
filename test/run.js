#!/usr/bin/env node
'use strict';
/*
 * cc2node repeatable test harness.
 *
 *   node test/run.js [options]
 *
 * What it does:
 *   1. Converts each requested Claude Code version with cc2node (cached under
 *      test/.cache/<version>-<platform>; re-runs are fast).
 *   2. Runs every produced build (cli.node18/20/22.js + raw cli.js) under every
 *      installed Node major (discovered from nvm) and checks that
 *      `--version` prints "<version> (Claude Code)".
 *   3. Prints a build × Node compatibility matrix and exits non-zero on any
 *      unexpected failure.
 *
 * Options:
 *   --versions a,b,c   versions to test (default: 2.1.185,2.1.195,2.1.113,2.1.114,2.1.126)
 *   --platform p       target platform (default: linux-x64)
 *   --nodes 18,20,...  Node majors to test (default: all installed of 18,20,22,24,26)
 *   --force            re-convert even if a cached output exists
 *   --keep             keep cache (default; conversions are always kept)
 *   --quick            only convert+test the first version
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');

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
  var a = { versions: ['2.1.185', '2.1.195', '2.1.113', '2.1.114', '2.1.126'], platform: 'linux-x64', nodes: null, force: false, quick: false };
  for (var i = 0; i < argv.length; i++) {
    var x = argv[i];
    if (x === '--versions') a.versions = argv[++i].split(',').map(function (s) { return s.trim(); });
    else if (x === '--platform') a.platform = argv[++i];
    else if (x === '--nodes') a.nodes = argv[++i].split(',').map(function (s) { return parseInt(s, 10); });
    else if (x === '--force') a.force = true;
    else if (x === '--keep') a.keep = true;
    else if (x === '--quick') a.quick = true;
  }
  if (a.quick) a.versions = a.versions.slice(0, 1);
  return a;
}

// discover installed node binaries: major -> path (prefer nvm, include current)
function discoverNodes(wanted) {
  var found = {};
  var nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    fs.readdirSync(nvmDir).forEach(function (v) {
      var m = v.match(/^v(\d+)\.(\d+)\.(\d+)/);
      if (!m) return;
      var maj = parseInt(m[1], 10);
      var bin = path.join(nvmDir, v, 'bin', 'node');
      if (!fs.existsSync(bin)) return;
      // keep highest patch per major
      if (!found[maj] || cmpVer(v, found[maj].v) > 0) found[maj] = { v: v, bin: bin };
    });
  } catch (e) { /* no nvm */ }
  // include the running node
  var cur = process.versions.node, curMaj = parseInt(cur.split('.')[0], 10);
  if (!found[curMaj]) found[curMaj] = { v: 'v' + cur, bin: process.execPath };

  var majors = Object.keys(found).map(Number).sort(function (a, b) { return a - b; });
  if (wanted) majors = majors.filter(function (m) { return wanted.indexOf(m) !== -1; });
  // verify each binary actually runs on this host (older macOS can't run prebuilt
  // newer Node — dyld/libc++ symbol errors). Skip the ones that don't.
  var unrunnable = [];
  majors = majors.filter(function (m) {
    var r = cp.spawnSync(found[m].bin, ['--version'], { encoding: 'utf8', timeout: 20000 });
    var ok = r.status === 0 && /^v\d+\./.test((r.stdout || '').trim());
    if (!ok) unrunnable.push(found[m].v + (r.stderr ? ' (' + r.stderr.trim().split('\n')[0].slice(0, 60) + ')' : ''));
    return ok;
  });
  return { map: found, majors: majors, unrunnable: unrunnable };
}
function cmpVer(a, b) {
  var pa = a.replace(/^v/, '').split('.').map(Number), pb = b.replace(/^v/, '').split('.').map(Number);
  for (var i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] - pb[i]; }
  return 0;
}

function convert(version, platform, force) {
  var outDir = path.join(CACHE, version + '-' + platform);
  var marker = path.join(outDir, 'cli.node22.js');
  if (!force && fs.existsSync(marker)) {
    return { outDir: outDir, cached: true, ok: true };
  }
  // reuse a local tarball if present, else let cc2node download by version
  var local = '/tmp/cc-' + version + '.tar.gz';
  var input = fs.existsSync(local) ? local : version;
  process.stdout.write('\n=== converting ' + version + ' (' + platform + ') from ' + (input === version ? 'downloads.claude.ai' : path.basename(input)) + ' ===\n');
  var r = cp.spawnSync(process.execPath, [BIN, input, '--platform', platform, '--out', outDir], { stdio: 'inherit' });
  return { outDir: outDir, cached: false, ok: r.status === 0 };
}

function runBuild(nodeBin, buildPath, expectVersion) {
  var r = cp.spawnSync(nodeBin, [buildPath, '--version'], { encoding: 'utf8', timeout: 60000 });
  var out = ((r.stdout || '') + (r.stderr || '')).trim();
  var ok = r.status === 0 && out.indexOf(expectVersion + ' (Claude Code)') !== -1;
  return { ok: ok, out: out.split('\n')[0] || '', status: r.status };
}

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

function main() {
  var args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(CACHE, { recursive: true });
  var nodes = discoverNodes(args.nodes);
  if (!nodes.majors.length) { console.error('no Node versions found to test'); process.exit(2); }

  console.log('cc2node test harness');
  console.log('  platform : ' + args.platform);
  console.log('  versions : ' + args.versions.join(', '));
  console.log('  node     : ' + nodes.majors.map(function (m) { return nodes.map[m].v; }).join(', '));
  if (nodes.unrunnable && nodes.unrunnable.length) {
    console.log('  skipped  : ' + nodes.unrunnable.join(', ') + '  — cannot run on this host');
  }

  var results = []; // {version, convertOk, cells: {build: {major: result}}}
  for (var vi = 0; vi < args.versions.length; vi++) {
    var version = args.versions[vi];
    var conv = convert(version, args.platform, args.force);
    var rec = { version: version, convertOk: conv.ok, outDir: conv.outDir, cells: {} };
    if (conv.ok) {
      for (var bi = 0; bi < BUILDS.length; bi++) {
        var b = BUILDS[bi];
        var bpath = path.join(conv.outDir, b.file);
        if (!fs.existsSync(bpath)) { continue; }
        rec.cells[b.file] = {};
        for (var mi = 0; mi < nodes.majors.length; mi++) {
          var maj = nodes.majors[mi];
          if (maj < b.min) { rec.cells[b.file][maj] = { na: true }; continue; }
          rec.cells[b.file][maj] = runBuild(nodes.map[maj].bin, bpath, version);
        }
      }
    }
    results.push(rec);
  }

  // ---- report ----
  var totalPass = 0, totalRun = 0, totalFail = 0;
  console.log('\n================ RESULTS ================');
  for (var ri = 0; ri < results.length; ri++) {
    var r = results[ri];
    console.log('\nClaude Code ' + r.version + (r.convertOk ? '' : '   <-- CONVERSION FAILED'));
    if (!r.convertOk) { totalFail++; continue; }
    var header = '  ' + pad('build', 18);
    for (var hi = 0; hi < nodes.majors.length; hi++) header += pad('node' + nodes.majors[hi], 9);
    console.log(header);
    Object.keys(r.cells).forEach(function (file) {
      var row = '  ' + pad(file, 18);
      nodes.majors.forEach(function (maj) {
        var c = r.cells[file][maj];
        var cell;
        if (!c) cell = '-';
        else if (c.na) cell = '·';
        else { totalRun++; if (c.ok) { totalPass++; cell = 'PASS'; } else { totalFail++; cell = 'FAIL'; } }
        row += pad(cell, 9);
      });
      console.log(row);
    });
  }
  console.log('\n=========================================');
  console.log('legend: PASS=ran & printed version  ·=N/A (build needs newer Node)  FAIL=error/wrong output');
  console.log('totals: ' + totalPass + '/' + totalRun + ' runs passed; ' +
    results.filter(function (r) { return r.convertOk; }).length + '/' + results.length + ' versions converted');
  process.exit(totalFail === 0 && totalRun > 0 ? 0 : 1);
}

main();
