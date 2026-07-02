# cc2node

[![npm](https://img.shields.io/npm/v/cc2node.svg)](https://www.npmjs.com/package/cc2node)
[![ci](https://github.com/cc-friend/cc2node/actions/workflows/ci.yml/badge.svg)](https://github.com/cc-friend/cc2node/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Convert any Bun-compiled Claude Code release into a pure-Node build that runs on plain **Node 18+**.
No Bun runtime required. Built on [unbunjs](https://www.npmjs.com/package/unbunjs).

Claude Code 2.1.112+ ships as a [Bun](https://bun.sh) `--compile` binary. cc2node downloads it, parses
the embedded module graph with unbunjs, de-buns the entry bundle so it runs under Node, transpiles it
to a single Node-18-compatible `cli.js`, and bundles ripgrep plus the runtime deps Bun provided natively.

```sh
npx cc2node 2.1.185
node cc2node-2.1.185-*/cli.js --version   # 2.1.185 (Claude Code)
```

## Why

Run Claude Code where the official binary cannot: old or constrained systems where the signed Bun
binary or a new-enough Node refuses to launch — a macOS 11 Intel MacBook (prebuilt Node 24+ dies with
a libc++ error), old or minimal Linux (old glibc; the bundled ripgrep is the static musl build), or
machines pinned to old Node (corporate images, LTS policies, CI bases). The `cli.js` cc2node emits
runs on all of them (Node 18+).

Other uses:

- Read or audit the real `cli.js` source (esbuild beautifies it).
- Diff two releases' `cli.js` to see what changed.
- Patch or customize through the editable Bun-to-Node shim.
- Debug under `node --inspect`, profilers, coverage, or custom loaders.
- Smaller footprint (about 35 MB versus the 220 MB binary).
- Reproducible, air-gapped installs: build once, run later with only Node.
- Pin and keep multiple versions side by side.

Native addons and `rg` are platform-specific, so build with `--platform` for your target. The
JavaScript core is platform-independent.

## Usage

```
cc2node <version|tarball|binary> [options]

Input:
  <version>            e.g. 2.1.185, or "latest" / "stable".
                       Downloaded from downloads.claude.ai (falls back to GitHub, then npm).
  <tarball|binary>     a claude-*.tar.gz or an already-extracted Bun `claude` binary.

Options:
  -p, --platform <p>   target platform (default: this host)
  -o, --out <dir>      output directory (default: ./cc2node-<version>-<platform>)
      --no-ripgrep     do not bundle ripgrep
      --no-install     do not npm install runtime deps into the output
      --keep-temp      keep the temp work dir
  -h, --help / -v, --version

Platforms: linux-x64, linux-x64-musl, linux-arm64, linux-arm64-musl, darwin-x64, darwin-arm64.
```

The output directory contains `cli.js` (runs on Node 18+), `bun-shim.cjs`, the `*.node` addons, `rg`,
a `package.json`, and a `node_modules` (ws, undici, ajv, ajv-formats). Config is read from `~/.claude`,
like the official build.

## How it works

1. Download the Bun binary from downloads.claude.ai (SHA-256 checked; GitHub and npm fallbacks).
2. Parse the embedded module graph with [unbunjs](https://www.npmjs.com/package/unbunjs) and take the
   entry module plus native addons.
3. De-bun `cli.js`: drop the `// @bun` directive, invoke the CommonJS wrapper Bun normally calls
   itself, and prepend `bun-shim.cjs` (a Node reimplementation of the `Bun.*` APIs).
4. Transpile to Node 18 with esbuild (lowering `using`) and prepend small runtime polyfills, producing
   one `cli.js` that runs on Node 18 through 26+.
5. Add ripgrep and `npm install` the runtime deps.

## Library API

```ts
import { convert } from 'cc2node';

const { version, outDir } = await convert({ input: '2.1.185', platform: 'linux-x64' });
console.log(version, outDir);
```

`convert(options)` resolves to `{ version, platform, outDir, modules }`. Options: `input` (required),
`platform`, `out`, `ripgrep`, `install`, `keepTemp`, `log`. Also exported: `PLATFORMS`, `hostPlatform`.

## Development

```sh
npm install
npm run checkall   # tsc typecheck + biome lint + biome format check + unit tests (no writes)
npm run fixall     # biome autofix (lint + format)
npm test           # unit tests (tsx + node:test)
npm run build      # compile TypeScript to dist/
npm run e2e        # heavy: convert real releases and run cli.js across Node majors (network)
```

CI runs `checkall` across Node 18–24 on push/PR.

### Releasing

`npm run release:patch` bumps with [vbt](https://www.npmjs.com/package/vbt) (commit, tag `vX.Y.Z`,
push). The tag triggers the publish workflow, which runs `checkall` then `npm publish` with provenance.
Set the `NPM_TOKEN` repo secret.

## License

MIT
