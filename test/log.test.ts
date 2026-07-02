import assert from 'node:assert/strict';
import { test } from 'node:test';
import log from '../src/log';

test('log exposes the Logger methods', () => {
  for (const m of ['step', 'info', 'ok', 'warn', 'err', 'raw', 'reset'] as const) {
    assert.equal(typeof log[m], 'function');
  }
});

test('log methods do not throw', () => {
  assert.doesNotThrow(() => log.ok('hello'));
});
