import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from '../src/cli';

test('parseArgs collects input + platform', () => {
  const a = parseArgs(['2.1.185', '-p', 'linux-x64']);
  assert.equal(a._[0], '2.1.185');
  assert.equal(a.platform, 'linux-x64');
});
test('parseArgs supports --out= and negation flags', () => {
  const a = parseArgs(['x', '--out=./build', '--no-ripgrep', '--no-install', '--keep-temp']);
  assert.equal(a.out, './build');
  assert.equal(a.ripgrep, false);
  assert.equal(a.install, false);
  assert.equal(a.keepTemp, true);
});
test('parseArgs no longer accepts --targets or --no-transpile', () => {
  assert.throws(() => parseArgs(['x', '--no-transpile']), /unknown option/);
  assert.throws(() => parseArgs(['x', '--targets', 'node18']), /unknown option/);
  assert.throws(() => parseArgs(['x', '-t', 'node18']), /unknown option/);
});
