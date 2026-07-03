/*
 * Install a launcher for a converted cli.js so a converted Claude Code runs as
 * e.g. `cc2`. Every file carries a `# cc2node launcher` marker so we only ever
 * detect/overwrite our own (never clobber a foreign file without --force).
 *
 *   Unix (Linux/macOS): a single `#!/bin/sh` wrapper.
 *   Windows: npm-style shims — `<name>.cmd` (cmd.exe), `<name>.ps1` (PowerShell)
 *     and an extensionless `<name>` sh wrapper (Git Bash / MSYS). No `npm link`.
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
  launcherPath: string; // primary launcher (Unix: the sh wrapper; Windows: the .cmd)
  launcherPaths: string[]; // every file written (1 on Unix, 3 on Windows)
  onPath: boolean;
  pathHint?: string; // command to add binDir to PATH when it is not already there
}

interface LauncherFile {
  path: string;
  body: string;
}

export function linkLauncher(opts: LinkOptions): LinkResult {
  fs.mkdirSync(opts.binDir, { recursive: true });
  const label = opts.version
    ? ' — Claude Code ' + opts.version + (opts.platform ? ' (' + opts.platform + ')' : '')
    : '';
  const files = process.platform === 'win32' ? windowsLaunchers(opts, label) : [unixLauncher(opts, label)];

  // safety: never clobber a file we didn't create
  for (const f of files) guardOverwrite(f.path, opts.force);
  for (const f of files) {
    fs.writeFileSync(f.path, f.body);
    try {
      fs.chmodSync(f.path, 0o755); // executable on Unix; no-op on Windows
    } catch {
      /* ignore */
    }
  }

  const onPath = isOnPath(opts.binDir);
  const result: LinkResult = { launcherPath: files[0].path, launcherPaths: files.map((f) => f.path), onPath };
  if (!onPath) result.pathHint = pathHint(opts.binDir);
  return result;
}

function unixLauncher(opts: LinkOptions, label: string): LauncherFile {
  const body = '#!/bin/sh\n' + MARKER + label + '\n' + 'exec node "' + opts.cliPath + '" "$@"\n';
  return { path: path.join(opts.binDir, opts.name), body };
}

function windowsLaunchers(opts: LinkOptions, label: string): LauncherFile[] {
  const base = path.join(opts.binDir, opts.name);
  const cli = opts.cliPath;
  return [
    // cmd.exe — CRLF line endings, REM-comment marker, forward exit code
    { path: base + '.cmd', body: '@ECHO off\r\nREM ' + MARKER + label + '\r\nnode "' + cli + '" %*\r\n' },
    // PowerShell — hash-comment marker, propagate node's exit code
    {
      path: base + '.ps1',
      body: '#!/usr/bin/env pwsh\n# ' + MARKER + label + '\nnode "' + cli + '" $args\nexit $LASTEXITCODE\n'
    },
    // extensionless sh wrapper for Git Bash / MSYS / Cygwin
    { path: base, body: '#!/bin/sh\n' + MARKER + label + '\nexec node "' + cli + '" "$@"\n' }
  ];
}

function guardOverwrite(file: string, force?: boolean): void {
  if (fs.existsSync(file) && !force) {
    let existing = '';
    try {
      existing = fs.readFileSync(file, 'utf8');
    } catch {
      /* ignore */
    }
    if (!existing.includes(MARKER)) {
      throw new Error(file + ' exists and is not a cc2node launcher — refusing to overwrite (use --force)');
    }
  }
}

function pathHint(binDir: string): string {
  // Windows: persist to the user PATH via setx (takes effect in new shells).
  if (process.platform === 'win32') return 'setx PATH "%PATH%;' + binDir + '"';
  return 'export PATH="' + binDir + ':$PATH"';
}

function samePath(a: string, b: string): boolean {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

function isOnPath(dir: string): boolean {
  return (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((e) => {
      try {
        return samePath(e, dir);
      } catch {
        return false;
      }
    });
}
