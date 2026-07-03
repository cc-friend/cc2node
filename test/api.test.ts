import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from '../src/index';

test('index exposes the public API', () => {
  assert.equal(typeof api.convert, 'function');
  assert.equal(typeof api.install, 'function');
  assert.equal(typeof api.linkLauncher, 'function');
  assert.equal(typeof api.hostPlatform, 'function');
  assert.ok(Array.isArray(api.PLATFORMS));
  assert.equal(typeof api.RUNTIME_DEPS, 'object');
});
