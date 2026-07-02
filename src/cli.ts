#!/usr/bin/env node
/*
 * cc2node — convert any Bun-compiled Claude Code release into a pure-Node build.
 *   cc2node <version|tarball|binary> [options]
 */
import fs from 'node:fs';
import path from 'node:path';
import { convert } from './convert';
import { PLATFORMS } from './download';
import log from './log';

function pkgVersion(): string {
  const p = path.join(__dirname, '..', 'package.json');
  return (JSON.parse(fs.readFileSync(p, 'utf8')) as { version: string }).version;
}

export interface Args {
  _: string[];
  platform: string | null;
  out: string | null;
  ripgrep: boolean;
  install: boolean;
  keepTemp: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = {
    _: [],
    platform: null,
    out: null,
    ripgrep: true,
    install: true,
    keepTemp: false,
    help: false,
    version: false
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
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
        if (x.startsWith('--platform=')) a.platform = x.slice(11);
        else if (x.startsWith('--out=')) a.out = x.slice(6);
        else if (x[0] === '-') throw new Error('unknown option: ' + x);
        else a._.push(x);
    }
  }
  return a;
}

function help(): void {
  process.stdout.write(
    'cc2node ' +
      pkgVersion() +
      ' — Bun-compiled Claude Code → pure Node\n\n' +
      'Usage:\n' +
      '  cc2node <version|tarball|binary> [options]\n\n' +
      'Input:\n' +
      '  <version>            e.g. 2.1.185, or "latest" / "stable"\n' +
      '                       downloaded from downloads.claude.ai (GitHub, then npm fallback)\n' +
      '  <tarball|binary>     a claude-*.tar.gz or an extracted Bun `claude` binary\n\n' +
      'Options:\n' +
      '  -p, --platform <p>   target platform (default: this host)\n' +
      '                       one of: ' +
      PLATFORMS.join(', ') +
      '\n' +
      '  -o, --out <dir>      output directory (default: ./cc2node-<version>-<platform>)\n' +
      '      --no-ripgrep     do not bundle ripgrep\n' +
      '      --no-install     do not run npm install for runtime deps\n' +
      '      --keep-temp      keep the temp work directory\n' +
      '  -h, --help           show this help\n' +
      '  -v, --version        print cc2node version\n'
  );
}

function main(): void {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    log.err((e as Error).message);
    process.exit(2);
  }

  if (args.version) {
    process.stdout.write(pkgVersion() + '\n');
    return;
  }
  if (args.help || !args._.length) {
    help();
    process.exit(args.help ? 0 : 1);
  }
  if (args.platform && !PLATFORMS.includes(args.platform)) {
    log.warn('unusual platform "' + args.platform + '" (known: ' + PLATFORMS.join(', ') + ')');
  }

  convert({
    input: args._[0],
    platform: args.platform ?? undefined,
    out: args.out ? path.resolve(args.out) : undefined,
    ripgrep: args.ripgrep,
    install: args.install,
    keepTemp: args.keepTemp,
    log
  })
    .then((r) => {
      log.ok('converted Claude Code ' + r.version + ' → ' + r.outDir);
      process.exit(0);
    })
    .catch((e: unknown) => {
      log.err((e as Error).message);
      if (process.env.DEBUG) console.error((e as Error).stack);
      process.exit(1);
    });
}

if (require.main === module) main();
