/*
 * Transpile the de-bunned cli.js to a specific Node target with esbuild (pure
 * transpile, no bundling): lowers syntax the target Node lacks — chiefly `using` /
 * `await using` — then prepends idempotent runtime polyfills esbuild cannot add
 * (Array.prototype.with, …). `target` is an esbuild node target, e.g. "node18".
 *
 * Uses esbuild-wasm (the WebAssembly build), not the native binary, so cc2js installs
 * and runs anywhere Node 18+ runs — including older macOS (10.15+), where the native
 * esbuild Go binary refuses to load (it links macOS 12+ symbols). Same transform API;
 * the only cost is a one-time initialize(). In Node it auto-loads its own bundled
 * esbuild.wasm — the wasmURL/wasmModule/worker options are browser-only and throw here.
 */
import * as esbuild from 'esbuild-wasm';

// esbuild-wasm must be initialized once per process before transform().
let ready: Promise<void> | undefined;
function ensureReady(): Promise<void> {
  if (!ready) ready = esbuild.initialize({});
  return ready;
}

export async function transpile(debunnedSource: string, polyfills: string, target: string): Promise<string> {
  await ensureReady();
  const src = debunnedSource.replace(/^#![^\n]*\n/, ''); // strip shebang for esbuild
  const result = await esbuild.transform(src, {
    loader: 'js',
    format: 'cjs',
    platform: 'node',
    target,
    legalComments: 'inline',
    logLevel: 'silent'
  });
  return '#!/usr/bin/env node\n' + polyfills.replace(/\s+$/, '') + '\n' + result.code;
}
