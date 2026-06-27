'use strict';
/*
 * Transpile the de-bunned cli.js down to specific Node targets with esbuild.
 *
 * esbuild here is used as a pure single-file *transpiler* (no bundling, no module
 * resolution): it re-prints the bundle, lowering syntax the target Node lacks —
 * most importantly the 390+ `using` / `await using` declarations (Node < 24) into
 * the __using/__callDispose helper pattern. It cannot add missing runtime methods,
 * so we prepend assets/polyfills.cjs (idempotent; covers Array.prototype.with etc.).
 */

var fs = require('fs');

function loadEsbuild() {
  try { return require('esbuild'); }
  catch (e) {
    throw new Error('esbuild is required for transpiling. Run `npm install` in the cc2node directory, or pass --no-transpile.');
  }
}

// Transpile `debunnedSource` (string) to `outFile` for `target` (e.g. "node18").
async function transpileTo(debunnedSource, outFile, target, polyfills) {
  var esbuild = loadEsbuild();
  // strip the shebang so esbuild sees clean JS; we re-add it (+ polyfills) after.
  var src = debunnedSource.replace(/^#![^\n]*\n/, '');
  var result = await esbuild.transform(src, {
    loader: 'js',
    format: 'cjs',
    platform: 'node',
    target: target,
    legalComments: 'inline',
    logLevel: 'silent'
  });
  var head = '#!/usr/bin/env node\n' + (polyfills ? polyfills.replace(/\s+$/, '') + '\n' : '');
  fs.writeFileSync(outFile, head + result.code);
  try { fs.chmodSync(outFile, 0o755); } catch (e) { /* ignore */ }
  return { outFile: outFile, bytes: Buffer.byteLength(head + result.code) };
}

module.exports = { transpileTo: transpileTo, loadEsbuild: loadEsbuild };
