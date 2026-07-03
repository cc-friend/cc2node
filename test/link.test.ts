import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { linkLauncher } from '../src/link';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cc2node-link-'));

test('linkLauncher writes an executable sh wrapper with marker', () => {
  const dir = tmp();
  const cli = path.join(dir, 'store', 'cli.js');
  const r = linkLauncher({ cliPath: cli, name: 'cc2', binDir: path.join(dir, 'bin') });
  const body = fs.readFileSync(r.launcherPath, 'utf8');
  assert.ok(body.startsWith('#!/bin/sh\n'));
  assert.ok(body.includes('# cc2node launcher'));
  assert.ok(body.includes('exec node "' + cli + '" "$@"'));
  assert.equal(path.basename(r.launcherPath), 'cc2');
  assert.ok((fs.statSync(r.launcherPath).mode & 0o111) !== 0); // executable
});

test('linkLauncher refuses to overwrite a non-cc2node file without force', () => {
  const bin = path.join(tmp(), 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'cc2'), '#!/bin/sh\necho real tool\n');
  assert.throws(() => linkLauncher({ cliPath: '/x/cli.js', name: 'cc2', binDir: bin }), /refusing to overwrite/);
  const r = linkLauncher({ cliPath: '/x/cli.js', name: 'cc2', binDir: bin, force: true });
  assert.ok(fs.readFileSync(r.launcherPath, 'utf8').includes('# cc2node launcher'));
});

test('linkLauncher overwrites its own previous launcher without force', () => {
  const bin = path.join(tmp(), 'bin');
  linkLauncher({ cliPath: '/a/cli.js', name: 'cc2', binDir: bin });
  const r = linkLauncher({ cliPath: '/b/cli.js', name: 'cc2', binDir: bin });
  assert.ok(fs.readFileSync(r.launcherPath, 'utf8').includes('exec node "/b/cli.js"'));
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
