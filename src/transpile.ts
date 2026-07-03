/*
 * Transpile the de-bunned cli.js to a specific Node target with esbuild (pure
 * transpile, no bundling): lowers syntax the target Node lacks — chiefly `using` /
 * `await using` — then prepends idempotent runtime polyfills esbuild cannot add
 * (Array.prototype.with, …). `target` is an esbuild node target, e.g. "node18".
 */
import { transform } from 'esbuild';

export async function transpile(debunnedSource: string, polyfills: string, target: string): Promise<string> {
  const src = debunnedSource.replace(/^#![^\n]*\n/, ''); // strip shebang for esbuild
  const result = await transform(src, {
    loader: 'js',
    format: 'cjs',
    platform: 'node',
    target,
    legalComments: 'inline',
    logLevel: 'silent'
  });
  return '#!/usr/bin/env node\n' + polyfills.replace(/\s+$/, '') + '\n' + result.code;
}
