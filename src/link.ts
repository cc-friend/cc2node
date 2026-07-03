/*
 * Install a launcher for a converted cli.js: write a small `#!/bin/sh` wrapper
 * (carrying a `# cc2node launcher` marker so we can safely detect/overwrite only
 * our own) into a directory on PATH, so a converted Claude Code runs as e.g. `cc2`.
 *
 * Unix (Linux/macOS) only. The Windows branch (.cmd/.ps1) is a separate effort.
 */
import fs from 'node:fs';
import path from 'node:path';

const MARKER = '# cc2node launcher';

export interface LinkOptions {
  cliPath: string; // absolute path to the converted cli.js
  name: string; // launcher command name, e.g. "cc2"
  binDir: string; // directory to write the launcher into
  version?: string; // for the marker comment
  platform?: string; // for the marker comment
  force?: boolean; // overwrite a file we didn't create
}

export interface LinkResult {
  launcherPath: string;
  onPath: boolean;
  pathHint?: string; // export line to add when binDir is not on PATH
}

export function linkLauncher(opts: LinkOptions): LinkResult {
  const launcherPath = path.join(opts.binDir, opts.name);

  // safety: never clobber a file we didn't create
  if (fs.existsSync(launcherPath) && !opts.force) {
    let existing = '';
    try {
      existing = fs.readFileSync(launcherPath, 'utf8');
    } catch {
      /* ignore */
    }
    if (!existing.includes(MARKER)) {
      throw new Error(launcherPath + ' exists and is not a cc2node launcher — refusing to overwrite (use --force)');
    }
  }

  fs.mkdirSync(opts.binDir, { recursive: true });
  const label = opts.version
    ? ' — Claude Code ' + opts.version + (opts.platform ? ' (' + opts.platform + ')' : '')
    : '';
  const script = '#!/bin/sh\n' + MARKER + label + '\n' + 'exec node "' + opts.cliPath + '" "$@"\n';
  fs.writeFileSync(launcherPath, script);
  fs.chmodSync(launcherPath, 0o755);

  const onPath = isOnPath(opts.binDir);
  const result: LinkResult = { launcherPath, onPath };
  if (!onPath) result.pathHint = 'export PATH="' + opts.binDir + ':$PATH"';
  return result;
}

function isOnPath(dir: string): boolean {
  const target = path.resolve(dir);
  return (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((e) => path.resolve(e) === target);
}
