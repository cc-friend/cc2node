import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostPlatform, PLATFORMS } from '../src/download';

test('PLATFORMS lists the win32 targets', () => {
  assert.ok(PLATFORMS.includes('win32-x64'));
  assert.ok(PLATFORMS.includes('win32-arm64'));
});

test('hostPlatform returns a <os>-<arch> in PLATFORMS for this host', () => {
  const p = hostPlatform();
  assert.match(p, /^(linux|darwin|win32)-(x64|arm64)(-musl)?$/);
  if (process.platform === 'win32') assert.ok(p.startsWith('win32-'));
  else if (process.platform === 'darwin') assert.ok(p.startsWith('darwin-'));
  else assert.ok(p.startsWith('linux-'));
  // arch half is always x64 or arm64
  assert.ok(p.endsWith('x64') || p.includes('arm64'));
});
