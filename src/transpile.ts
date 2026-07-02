/*
 * Transpile the de-bunned cli.js down to Node 18 with esbuild (pure transpile, no
 * bundling): lowers syntax Node 18 lacks — chiefly `using` / `await using` — then
 * we prepend idempotent runtime polyfills esbuild cannot add (Array.prototype.with, …).
 */
import { transform } from 'esbuild';

export async function transpileToNode18(debunnedSource: string, polyfills: string): Promise<string> {
  const src = debunnedSource.replace(/^#![^\n]*\n/, ''); // strip shebang for esbuild
  const result = await transform(src, {
    loader: 'js',
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    legalComments: 'inline',
    logLevel: 'silent'
  });
  return '#!/usr/bin/env node\n' + polyfills.replace(/\s+$/, '') + '\n' + result.code;
}
