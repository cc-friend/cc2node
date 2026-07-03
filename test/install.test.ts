import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { cc2Home, defaultBinDir } from '../src/install';

test('cc2Home is ~/.cc2node', () => {
  assert.equal(cc2Home(), path.join(os.homedir(), '.cc2node'));
});

test('defaultBinDir is OS-appropriate', () => {
  const d = defaultBinDir();
  if (process.platform === 'win32') assert.equal(d, path.join(os.homedir(), '.cc2node', 'bin'));
  else assert.equal(d, path.join(os.homedir(), '.local', 'bin'));
});
