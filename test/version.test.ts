import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sniffVersion } from '../src/version';

test('sniffVersion reads a // Version: line', () => {
  assert.equal(sniffVersion('// @bun\n// Version: 2.1.185\ncode'), '2.1.185');
});
test('sniffVersion reads a prerelease', () => {
  assert.equal(sniffVersion('// Version: 2.2.0-beta.1\n'), '2.2.0-beta.1');
});
test('sniffVersion returns null when absent', () => {
  assert.equal(sniffVersion('no version marker here'), null);
});
