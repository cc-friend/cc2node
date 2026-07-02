import assert from 'node:assert/strict';
import { test } from 'node:test';
import { debun } from '../src/debun';

const SHIM = 'globalThis.Bun = {};\n';

test('debun strips the // @bun directive and invokes the wrapper', () => {
  const bundle =
    '// @bun @bytecode @bun-cjs\n' +
    '(function(exports, require, module, __filename, __dirname) {\nmodule.exports = 42;\n})';
  const out = debun(bundle, SHIM, '9.9.9');
  assert.ok(out.startsWith('#!/usr/bin/env node\n'));
  assert.ok(!out.includes('// @bun @bytecode'));
  assert.ok(out.includes('globalThis.Bun'));
  assert.ok(out.includes('})(module.exports, require, module, __filename, __dirname);'));
  assert.ok(out.includes('Claude Code 9.9.9'));
});

test('debun wraps a non-wrapped bundle', () => {
  const out = debun('// @bun\nvar x = 1; module.exports = x;', SHIM, '1.0.0');
  assert.ok(out.includes('(function(exports, require, module, __filename, __dirname) {'));
  assert.ok(out.includes('})(module.exports, require, module, __filename, __dirname);'));
});

test('debun accepts a Buffer', () => {
  const out = debun(
    Buffer.from('// @bun\n(function(exports, require, module, __filename, __dirname) {})'),
    SHIM,
    '1.2.3'
  );
  assert.ok(out.includes('Claude Code 1.2.3'));
});
