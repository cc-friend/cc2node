import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { linkLauncher } from '../src/link';

const isWin = process.platform === 'win32';
const unixOnly = { skip: isWin ? 'unix-only' : false };
const winOnly = { skip: isWin ? false : 'windows-only' };

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cc2node-link-'));

// ---- Unix: single sh wrapper ----
test('linkLauncher writes an executable sh wrapper with marker', unixOnly, () => {
  const dir = tmp();
  const cli = path.join(dir, 'store', 'cli.js');
  const r = linkLauncher({ cliPath: cli, name: 'cc2', binDir: path.join(dir, 'bin') });
  const body = fs.readFileSync(r.launcherPath, 'utf8');
  assert.ok(body.startsWith('#!/bin/sh\n'));
  assert.ok(body.includes('# cc2node launcher'));
  assert.ok(body.includes('exec node "' + cli + '" "$@"'));
  assert.equal(path.basename(r.launcherPath), 'cc2');
  assert.equal(r.launcherPaths.length, 1);
  assert.ok((fs.statSync(r.launcherPath).mode & 0o111) !== 0); // executable
});

// ---- Windows: .cmd / .ps1 / sh shims ----
test('linkLauncher writes .cmd/.ps1/sh shims with markers', winOnly, () => {
  const dir = tmp();
  const cli = path.join(dir, 'store', 'cli.js');
  const bin = path.join(dir, 'bin');
  const r = linkLauncher({ cliPath: cli, name: 'cc2', binDir: bin, version: '2.1.199', platform: 'win32-x64' });
  assert.equal(path.basename(r.launcherPath), 'cc2.cmd'); // primary
  assert.equal(r.launcherPaths.length, 3);

  const cmd = fs.readFileSync(path.join(bin, 'cc2.cmd'), 'utf8');
  assert.ok(cmd.startsWith('@ECHO off'));
  assert.ok(cmd.includes('REM # cc2node launcher'));
  assert.ok(cmd.includes('node "' + cli + '" %*'));
  assert.ok(cmd.includes('\r\n')); // CRLF for cmd.exe

  const ps1 = fs.readFileSync(path.join(bin, 'cc2.ps1'), 'utf8');
  assert.ok(ps1.includes('# cc2node launcher'));
  assert.ok(ps1.includes('node "' + cli + '" $args'));
  assert.ok(ps1.includes('exit $LASTEXITCODE'));

  const sh = fs.readFileSync(path.join(bin, 'cc2'), 'utf8');
  assert.ok(sh.startsWith('#!/bin/sh\n'));
  assert.ok(sh.includes('exec node "' + cli + '" "$@"'));
});

// ---- overwrite safety (both platforms) ----
test('linkLauncher refuses to overwrite a foreign launcher without force', () => {
  const bin = path.join(tmp(), 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const foreign = path.join(bin, isWin ? 'cc2.cmd' : 'cc2');
  fs.writeFileSync(foreign, 'echo real tool\n');
  assert.throws(() => linkLauncher({ cliPath: '/x/cli.js', name: 'cc2', binDir: bin }), /refusing to overwrite/);
  const r = linkLauncher({ cliPath: '/x/cli.js', name: 'cc2', binDir: bin, force: true });
  assert.ok(fs.readFileSync(r.launcherPath, 'utf8').includes('# cc2node launcher'));
});

test('linkLauncher overwrites its own previous launcher without force', () => {
  const bin = path.join(tmp(), 'bin');
  linkLauncher({ cliPath: '/a/cli.js', name: 'cc2', binDir: bin });
  const r = linkLauncher({ cliPath: '/b/cli.js', name: 'cc2', binDir: bin });
  assert.ok(fs.readFileSync(r.launcherPath, 'utf8').includes('/b/cli.js'));
});

test('linkLauncher reports onPath + pathHint', () => {
  const bin = path.join(tmp(), 'bin');
  const r1 = linkLauncher({ cliPath: '/x/cli.js', name: 'cc2', binDir: bin });
  assert.equal(r1.onPath, false);
  assert.ok(r1.pathHint?.includes(bin));

  const saved = process.env.PATH;
  process.env.PATH = bin + path.delimiter + (saved || '');
  const r2 = linkLauncher({ cliPath: '/x/cli.js', name: 'cc2', binDir: bin, force: true });
  assert.equal(r2.onPath, true);
  assert.equal(r2.pathHint, undefined);
  process.env.PATH = saved;
});
