#!/usr/bin/env node
'use strict';
/*
 * cc2node — convert any Bun-compiled Claude Code release into a pure-Node build.
 *
 * Usage:
 *   cc2node <version|tarball|binary> [options]
 *
 * Examples:
 *   cc2node 2.1.185
 *   cc2node 2.1.126 --platform linux-x64-musl
 *   cc2node ./claude-darwin-x64.tar.gz --out ./build
 *   cc2node /path/to/claude --no-ripgrep --targets node18,node22
 */

var path = require('path');
var log = require('../src/log');
var pkg = require('../package.json');
var convertMod = require('../src/convert');
var downloadMod = require('../src/download');

function help() {
  var p = downloadMod.PLATFORMS.join(', ');
  process.stdout.write(
    'cc2node ' +
      pkg.version +
      ' — Bun-compiled Claude Code → pure Node\n' +
      '\n' +
      'Usage:\n' +
      '  cc2node <version|tarball|binary> [options]\n' +
      '\n' +
      'Input:\n' +
      '  <version>            e.g. 2.1.185 — downloaded from downloads.claude.ai\n' +
      '                       (falls back to GitHub releases, then npm)\n' +
      '  <tarball|binary>     path to a claude-*.tar.gz or an extracted Bun `claude` binary\n' +
      '\n' +
      'Options:\n' +
      '  -p, --platform <p>   target platform (default: this host)\n' +
      '                       one of: ' +
      p +
      '\n' +
      '  -o, --out <dir>      output directory (default: ./cc2node-<version>-<platform>)\n' +
      '  -t, --targets <list> transpile targets, comma-separated (default: node18,node20,node22)\n' +
      '      --no-transpile   only emit the raw de-bunned cli.js\n' +
      '      --no-ripgrep     do not bundle ripgrep\n' +
      '      --no-install     do not run npm install for runtime deps\n' +
      '      --keep-temp      keep the temp work directory\n' +
      '  -h, --help           show this help\n' +
      '  -v, --version        print cc2node version\n'
  );
}

function parseArgs(argv) {
  var a = {
    _: [],
    platform: null,
    out: null,
    targets: null,
    transpile: true,
    ripgrep: true,
    install: true,
    keepTemp: false,
    help: false,
    version: false
  };
  for (var i = 0; i < argv.length; i++) {
    var x = argv[i];
    switch (x) {
      case '-h':
      case '--help':
        a.help = true;
        break;
      case '-v':
      case '--version':
        a.version = true;
        break;
      case '-p':
      case '--platform':
        a.platform = argv[++i];
        break;
      case '-o':
      case '--out':
        a.out = argv[++i];
        break;
      case '-t':
      case '--targets':
        a.targets = argv[++i];
        break;
      case '--no-transpile':
        a.transpile = false;
        break;
      case '--no-ripgrep':
        a.ripgrep = false;
        break;
      case '--no-install':
        a.install = false;
        break;
      case '--keep-temp':
        a.keepTemp = true;
        break;
      default:
        if (x.indexOf('--platform=') === 0) a.platform = x.slice(11);
        else if (x.indexOf('--out=') === 0) a.out = x.slice(6);
        else if (x.indexOf('--targets=') === 0) a.targets = x.slice(10);
        else if (x[0] === '-') {
          log.err('unknown option: ' + x);
          process.exit(2);
        } else a._.push(x);
    }
  }
  return a;
}

(function main() {
  var args = parseArgs(process.argv.slice(2));
  if (args.version) {
    process.stdout.write(pkg.version + '\n');
    return;
  }
  if (args.help || !args._.length) {
    help();
    process.exit(args.help ? 0 : 1);
  }

  if (args.platform && downloadMod.PLATFORMS.indexOf(args.platform) === -1) {
    log.warn('unusual platform "' + args.platform + '" (known: ' + downloadMod.PLATFORMS.join(', ') + ')');
  }

  var targets = args.targets
    ? args.targets
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  convertMod
    .convert({
      input: args._[0],
      platform: args.platform,
      out: args.out ? path.resolve(args.out) : null,
      targets: targets,
      transpile: args.transpile,
      ripgrep: args.ripgrep,
      install: args.install,
      keepTemp: args.keepTemp,
      log: log
    })
    .then((r) => {
      log.ok('converted Claude Code ' + r.version + ' → ' + r.outDir);
      process.exit(0);
    })
    .catch((e) => {
      log.err(e.message);
      if (process.env.DEBUG) console.error(e.stack);
      process.exit(1);
    });
})();
