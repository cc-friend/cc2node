#!/usr/bin/env node
/*
 * cc2node — convert any Bun-compiled Claude Code release into a pure-Node build.
 *   cc2node [<version|latest|stable|tarball|binary>] [options]
 *   cc2node                # shortcut for `cc2node latest --link` (install/update `cc2`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { convert } from './convert';
import { hostPlatform, PLATFORMS } from './download';
import { install } from './install';
import log from './log';

function pkgVersion(): string {
  const p = path.join(__dirname, '..', 'package.json');
  return (JSON.parse(fs.readFileSync(p, 'utf8')) as { version: string }).version;
}

export interface Args {
  _: string[];
  link: boolean;
  linkName: string;
  binDir: string | null;
  target: string | null;
  platform: string | null;
  out: string | null;
  ripgrep: boolean;
  install: boolean;
  force: boolean;
  keepTemp: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = {
    _: [],
    link: false,
    linkName: 'cc2',
    binDir: null,
    target: null,
    platform: null,
    out: null,
    ripgrep: true,
    install: true,
    force: false,
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
      case '--link':
        a.link = true;
        break;
      case '--bin-dir':
        a.binDir = argv[++i];
        break;
      case '-t':
      case '--target':
        a.target = argv[++i];
        break;
      case '-p':
      case '--platform':
        a.platform = argv[++i];
        break;
      case '-o':
      case '--out':
        a.out = argv[++i];
        break;
      case '-f':
      case '--force':
        a.force = true;
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
        if (x.startsWith('--link=')) {
          a.link = true;
          a.linkName = x.slice(7);
        } else if (x.startsWith('--bin-dir=')) a.binDir = x.slice(10);
        else if (x.startsWith('--target=')) a.target = x.slice(9);
        else if (x.startsWith('--platform=')) a.platform = x.slice(11);
        else if (x.startsWith('--out=')) a.out = x.slice(6);
        else if (x[0] === '-') throw new Error('unknown option: ' + x);
        else a._.push(x);
    }
  }
  return a;
}

// Validate/normalise a --target value to an esbuild "nodeXX" string, min node18.
export function normalizeTarget(t: string): string {
  const m = String(t).match(/^(?:node)?(\d+)$/);
  if (!m) throw new Error('bad --target "' + t + '" (expected node18, node20, … or a number)');
  const major = Number.parseInt(m[1], 10);
  if (major < 18) throw new Error('minimum --target is node18 (Node < 18 needs extra polyfills; not supported)');
  return 'node' + major;
}

// Default target = the Node running cc2node (>= 18), so the build fits this machine.
export function defaultTarget(major = Number.parseInt(process.versions.node.split('.')[0], 10)): string {
  return 'node' + Math.max(18, major);
}

function help(): void {
  const binDefault = process.platform === 'win32' ? '%USERPROFILE%\\.cc2node\\bin' : '~/.local/bin';
  process.stdout.write(
    'cc2node ' +
      pkgVersion() +
      ' — Bun-compiled Claude Code → pure Node\n\n' +
      'Usage:\n' +
      '  cc2node [<version|latest|stable|tarball|binary>] [options]\n' +
      '  cc2node                  install/update the latest as `cc2` (= cc2node latest --link)\n\n' +
      'Options:\n' +
      '      --link[=<name>]      install to ~/.cc2node and put a launcher on PATH (default name: cc2)\n' +
      '      --bin-dir <dir>      where the launcher goes (default: ' +
      binDefault +
      ')\n' +
      '  -t, --target <nodeXX>    transpile target, node18+ (default: this Node, ' +
      defaultTarget() +
      ')\n' +
      '  -p, --platform <p>       target platform (default: this host)\n' +
      '                           one of: ' +
      PLATFORMS.join(', ') +
      '\n' +
      '  -o, --out <dir>          output directory (overrides the default location)\n' +
      '  -f, --force              re-convert even if cached; overwrite a foreign launcher\n' +
      '      --no-ripgrep         do not bundle ripgrep\n' +
      '      --no-install         do not npm install runtime deps into the output\n' +
      '      --keep-temp          keep the temp work directory\n' +
      '  -h, --help / -v, --version\n'
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
  if (args.help) {
    help();
    process.exit(0);
  }

  const platform = args.platform ?? hostPlatform();
  if (args.platform && !PLATFORMS.includes(args.platform)) {
    log.warn('unusual platform "' + args.platform + '" (known: ' + PLATFORMS.join(', ') + ')');
  }

  let target: string;
  try {
    target = args.target ? normalizeTarget(args.target) : defaultTarget();
  } catch (e) {
    log.err((e as Error).message);
    process.exit(2);
  }

  const bare = args._.length === 0; // `cc2node` with no input
  const input = args._[0] ?? 'latest';
  const doLink = args.link || bare; // bare ⇒ latest --link

  const fail = (e: unknown) => {
    log.err((e as Error).message);
    if (process.env.DEBUG) console.error((e as Error).stack);
    process.exit(1);
  };

  if (doLink) {
    if (args.platform && args.platform !== hostPlatform()) {
      log.warn('linking a ' + platform + ' build; it will not run on this host (' + hostPlatform() + ')');
    }
    if (!args.install) log.warn('--no-install with --link: the linked command will lack runtime deps');
    install({
      input,
      name: args.linkName,
      platform,
      target,
      binDir: args.binDir ?? undefined,
      out: args.out ? path.resolve(args.out) : undefined,
      install: args.install,
      ripgrep: args.ripgrep,
      force: args.force,
      keepTemp: args.keepTemp,
      log
    })
      .then((r) => {
        log.ok(
          args.linkName + ' → ' + r.launcherPath + '  [Claude Code ' + r.version + (r.cached ? ', cached' : '') + ']'
        );
        if (!r.onPath) {
          const dir = path.dirname(r.launcherPath);
          log.warn(dir + ' is not on PATH.');
          if (process.platform === 'win32') {
            log.warn('add it to your user PATH (new shells only):  ' + r.pathHint);
            log.warn('or: System → Environment Variables → Path → New → ' + dir);
          } else {
            log.warn('add it to your shell rc (~/.bashrc, ~/.zshrc, ~/.profile):  ' + r.pathHint);
          }
        }
        log.step('run:  ' + args.linkName + ' --version');
        process.exit(0);
      })
      .catch(fail);
    return;
  }

  convert({
    input,
    platform,
    target,
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
    .catch(fail);
}

if (require.main === module) main();
