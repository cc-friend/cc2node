import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { transpileToNode18 } from '../src/transpile';

test('transpileToNode18 lowers `using` and prepends polyfills', async () => {
  const POLY = '/* POLYFILLS */';
  const src =
    '#!/usr/bin/env node\n' +
    'function f(){ using d = { [Symbol.dispose](){} }; return 1; }\n' +
    'module.exports = f();\n';
  const out = await transpileToNode18(src, POLY);

  assert.ok(out.startsWith('#!/usr/bin/env node\n'));
  assert.ok(out.includes('/* POLYFILLS */'));
  assert.ok(!/\busing\s+d\b/.test(out)); // `using` declaration lowered away

  const body = out.replace(/^#![^\n]*\n/, '');
  assert.doesNotThrow(() => vm.compileFunction(body, ['exports', 'require', 'module', '__filename', '__dirname']));
});
