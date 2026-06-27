'use strict';
/*
 * convert: the full pipeline.
 *   obtain binary → unpack module graph → de-bun cli.js → write native addons →
 *   transpile Node 18/20/22 → write package.json + npm install runtime deps →
 *   fetch ripgrep → write README.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');

var defaultLog = require('./log');
var downloadMod = require('./download');
var unpackMod = require('./unpack-bun');
var debunMod = require('./debun');
var transpileMod = require('./transpile');
var ripgrepMod = require('./ripgrep');

var ASSETS = path.join(__dirname, '..', 'assets');

// Runtime modules Bun provided natively that the bundle require()s under Node.
// undici is pinned to ^6 so the SAME install works on Node 18–22+ (undici 7/8
// require Node 20+, which would break the Node 18 build).
var RUNTIME_DEPS = {
  ws: '^8.18.0',
  undici: '^6.21.3',
  ajv: '^8.17.1',
  'ajv-formats': '^3.0.1'
};

var DEFAULT_TARGETS = ['node18', 'node20', 'node22'];

function fmtBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

async function convert(opts) {
  var log = opts.log || defaultLog;
  var platform = opts.platform || downloadMod.hostPlatform();
  var targets = opts.targets || DEFAULT_TARGETS;
  var doTranspile = opts.transpile !== false;
  var doInstall = opts.install !== false;
  var doRipgrep = opts.ripgrep !== false;

  var workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc2node-'));
  var cleanup = function () {
    if (opts.keepTemp) { log.info('kept temp dir ' + workDir); return; }
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  };

  try {
    // 1) obtain the Bun binary
    var binPath = await downloadMod.obtainBinary(opts.input, platform, workDir, log);
    var binSize = fs.statSync(binPath).size;
    log.ok('binary ready (' + fmtBytes(binSize) + ')');

    // 2) unpack the embedded module graph
    log.step('Unpacking Bun module graph');
    var buf = fs.readFileSync(binPath);
    var g = unpackMod.unpackBun(buf);
    var version = g.version || (/^[0-9.]+/.test(String(opts.input)) ? opts.input : 'unknown');
    log.ok('found ' + g.modules.length + ' modules; entry=' + g.entry.basename +
      ' (' + fmtBytes(g.entry.content.length) + '); version=' + version +
      '  [base=' + g.base + ']');

    // 3) prepare output dir
    var outDir = opts.out || path.resolve(process.cwd(), 'cc2node-' + version + '-' + platform);
    fs.mkdirSync(outDir, { recursive: true });

    // 4) de-bun cli.js
    log.step('De-bunning cli.js');
    var shimSource = fs.readFileSync(path.join(ASSETS, 'bun-shim.cjs'), 'utf8');
    var debunned = debunMod.debun(g.entry.content, shimSource, version);
    var cliPath = path.join(outDir, 'cli.js');
    fs.writeFileSync(cliPath, debunned);
    fs.chmodSync(cliPath, 0o755);
    fs.copyFileSync(path.join(ASSETS, 'bun-shim.cjs'), path.join(outDir, 'bun-shim.cjs'));
    log.ok('cli.js (' + fmtBytes(Buffer.byteLength(debunned)) + ')  [runs on Node 22+]');

    // 5) native addons (.node / .wasm) — written under their basename so the shim's
    //    /$bunfs/root/* redirect resolves them next to cli.js
    var assetsWritten = [];
    g.modules.forEach(function (m) {
      if (/\.(node|wasm)$/.test(m.basename)) {
        fs.writeFileSync(path.join(outDir, m.basename), m.content);
        assetsWritten.push(m.basename + ' (' + fmtBytes(m.content.length) + ')');
      }
    });
    if (assetsWritten.length) log.ok('native addons: ' + assetsWritten.join(', '));

    // 6) transpile to Node targets
    var builds = [{ file: 'cli.js', target: 'node22+ (raw)' }];
    if (doTranspile) {
      log.step('Transpiling (' + targets.join(', ') + ')');
      var polyfills = fs.readFileSync(path.join(ASSETS, 'polyfills.cjs'), 'utf8');
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        var outName = 'cli.' + t + '.js';
        var r = await transpileMod.transpileTo(debunned, path.join(outDir, outName), t, polyfills);
        builds.push({ file: outName, target: t });
        log.ok(outName + ' (' + fmtBytes(r.bytes) + ')');
      }
    }

    // 7) output package.json + runtime deps
    var outPkg = {
      name: 'claude-code-' + version + '-node',
      version: '1.0.0',
      private: true,
      description: 'Pure-Node build of Claude Code ' + version + ' (' + platform + '), de-bunned by cc2node.',
      type: 'commonjs',
      bin: { claude: 'cli.js' },
      engines: { node: '>=18' },
      dependencies: RUNTIME_DEPS
    };
    fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(outPkg, null, 2) + '\n');

    if (doInstall) {
      log.step('Installing runtime deps (ws, undici, ajv, ajv-formats)');
      try {
        cp.execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', { cwd: outDir, stdio: 'inherit' });
        log.ok('node_modules installed');
      } catch (e) {
        log.warn('npm install failed (' + e.message + '). Run `npm install` in ' + outDir + ' manually.');
      }
    }

    // 8) ripgrep
    if (doRipgrep) {
      log.step('Fetching ripgrep');
      try {
        var got = await ripgrepMod.fetchRipgrep(platform, path.join(outDir, 'rg'), workDir, log);
        if (got) log.ok('rg bundled');
      } catch (e) {
        log.warn('ripgrep fetch failed (' + e.message + '). Grep/Glob will use rg from PATH.');
      }
    }

    // 9) output README
    writeOutputReadme(outDir, version, platform, builds);

    log.step('Done → ' + outDir);
    return { version: version, platform: platform, outDir: outDir, builds: builds, modules: g.modules.length };
  } finally {
    cleanup();
  }
}

function writeOutputReadme(outDir, version, platform, builds) {
  var lines = [];
  lines.push('# Claude Code ' + version + ' — pure-Node build (' + platform + ')');
  lines.push('');
  lines.push('Produced by **cc2node** from the Bun-compiled `claude` binary. No Bun runtime required.');
  lines.push('');
  lines.push('## Which file to run');
  lines.push('');
  lines.push('| file | Node version |');
  lines.push('| --- | --- |');
  lines.push('| `cli.node18.js` | Node 18, 19 (also runs on any newer Node) |');
  lines.push('| `cli.node20.js` | Node 20, 21 |');
  lines.push('| `cli.node22.js` | Node 22+ (recommended for 24/25/26 too) |');
  lines.push('| `cli.js` (raw) | Node 24+ only (original bundle; uses `using`) |');
  lines.push('');
  lines.push('```sh');
  lines.push('node cli.node18.js --version   # or the file matching your Node');
  lines.push('node cli.js                    # interactive TUI');
  lines.push('```');
  lines.push('');
  lines.push('Auth/config are read from `~/.claude`, exactly like the official build.');
  lines.push('');
  lines.push('## Files');
  lines.push('- `cli.js` — de-bunned bundle (Bun shim inlined) for newest Node');
  lines.push('- `cli.node{18,20,22}.js` — esbuild-transpiled builds (+ idempotent runtime polyfills)');
  lines.push('- `bun-shim.cjs` — Bun→Node compatibility layer (reference copy)');
  lines.push('- `*.node` — native addons extracted from the Bun binary');
  lines.push('- `rg` — ripgrep (Grep/Glob); the shim puts this dir on PATH');
  lines.push('- `node_modules/` — ws, undici, ajv, ajv-formats (Bun provided these natively)');
  lines.push('');
  fs.writeFileSync(path.join(outDir, 'README.md'), lines.join('\n'));
}

module.exports = { convert: convert, RUNTIME_DEPS: RUNTIME_DEPS, DEFAULT_TARGETS: DEFAULT_TARGETS };
