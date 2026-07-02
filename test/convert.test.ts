import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BunModule } from 'unbunjs';
import { pickEntry, RUNTIME_DEPS } from '../src/convert';

const mod = (name: string, is_entry_point: boolean, contents_length: number): BunModule =>
  ({ name, is_entry_point, contents_length }) as BunModule;

test('pickEntry prefers is_entry_point', () => {
  const e = pickEntry([mod('/$bunfs/root/a.js', false, 100), mod('/$bunfs/root/cli.js', true, 50)]);
  assert.equal(e?.name, '/$bunfs/root/cli.js');
});
test('pickEntry falls back to a cli.js by name', () => {
  const e = pickEntry([mod('/$bunfs/root/x.js', false, 10), mod('/$bunfs/root/cli.js', false, 20)]);
  assert.equal(e?.name, '/$bunfs/root/cli.js');
});
test('pickEntry falls back to the largest js', () => {
  const e = pickEntry([mod('/$bunfs/root/small.js', false, 10), mod('/$bunfs/root/big.js', false, 999)]);
  assert.equal(e?.name, '/$bunfs/root/big.js');
});
test('RUNTIME_DEPS pins undici to ^6 for Node 18', () => {
  assert.match(RUNTIME_DEPS.undici, /^\^6\./);
});
