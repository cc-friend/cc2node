import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultTarget, normalizeTarget, parseArgs } from '../src/cli';

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
test('parseArgs rejects --no-transpile and --targets (plural)', () => {
  assert.throws(() => parseArgs(['x', '--no-transpile']), /unknown option/);
  assert.throws(() => parseArgs(['x', '--targets', 'node18']), /unknown option/);
});

test('parseArgs handles --link and --link=name', () => {
  assert.equal(parseArgs(['--link']).link, true);
  assert.equal(parseArgs(['--link']).linkName, 'cc2');
  const a = parseArgs(['2.1.185', '--link=mycc']);
  assert.equal(a.link, true);
  assert.equal(a.linkName, 'mycc');
  assert.equal(a._[0], '2.1.185');
});

test('parseArgs handles --target, --bin-dir, -f', () => {
  assert.equal(parseArgs(['-t', 'node20']).target, 'node20');
  assert.equal(parseArgs(['--target=node22']).target, 'node22');
  assert.equal(parseArgs(['--bin-dir=/opt/bin']).binDir, '/opt/bin');
  assert.equal(parseArgs(['-f']).force, true);
});

test('parseArgs: addPath defaults on and --no-add-path turns it off', () => {
  assert.equal(parseArgs([]).addPath, true);
  assert.equal(parseArgs(['--add-path']).addPath, true);
  assert.equal(parseArgs(['--no-add-path']).addPath, false);
});

test('normalizeTarget accepts node18+ and rejects <18', () => {
  assert.equal(normalizeTarget('node20'), 'node20');
  assert.equal(normalizeTarget('22'), 'node22');
  assert.throws(() => normalizeTarget('node16'), /node18/);
  assert.throws(() => normalizeTarget('14'), /node18/);
  assert.throws(() => normalizeTarget('nope'), /bad --target/);
});

test('defaultTarget follows current major, clamped to 18', () => {
  assert.equal(defaultTarget(24), 'node24');
  assert.equal(defaultTarget(18), 'node18');
  assert.equal(defaultTarget(16), 'node18');
});
