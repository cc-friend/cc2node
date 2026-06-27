# cc2node

[![npm](https://img.shields.io/npm/v/cc2node.svg)](https://www.npmjs.com/package/cc2node)
[![ci](https://github.com/cc-friend/cc2node/actions/workflows/ci.yml/badge.svg)](https://github.com/cc-friend/cc2node/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Convert **any Bun-compiled Claude Code release** into a pure-**Node** build that runs on
plain Node 18 / 20 / 22 / 24+ — no Bun runtime required.

Claude Code ≥ 2.1.112 ships as a [Bun](https://bun.sh) `--compile` single-file binary.
`cc2node` downloads that binary, unpacks the JavaScript + native addons embedded inside it,
"de-buns" the entry bundle so it runs under Node, and transpiles Node 18/20/22 builds.

```sh
npx cc2node 2.1.185         # no install needed; writes ./cc2node-2.1.185-<platform>/
node cc2node-2.1.185-*/cli.node22.js --version   # → 2.1.185 (Claude Code)
```

## Why

The official build is a single Bun-compiled native binary. That's great until the binary —
or a Node new enough to be its alternative — won't run on your machine. cc2node turns Claude
Code back into ordinary Node JavaScript, which runs almost anywhere Node 18+ does.

**Main use case — run Claude Code where the official binary can't:**

- **Old macOS** (e.g. macOS 11 Big Sur, the ceiling for many 2017–2020 Intel Macs). The
  signed Bun binary needs a newer macOS, *and* prebuilt Node 24+ won't launch there either
  (`dyld: Symbol not found`, newer libc++). cc2node's **Node 18/20/22** builds run fine.
- **Old / minimal Linux** (old glibc, locked-down distros). Node 18–22 has very broad reach,
  and the bundled ripgrep is the static musl build so it works on old glibc too.
- **Environments pinned to old Node** (corporate images, LTS policies, CI base images stuck on
  Node 18/20/22) — run Claude Code on the Node you already have instead of a standalone binary.

**Also useful for:**

- **Read / audit the source** — recover the real `cli.js` bundle as JavaScript (esbuild
  beautifies it to ~400k readable lines). See what Claude Code actually does.
- **Diff versions** — extract two releases' `cli.js` and diff them; the opaque binary makes
  this impossible, plain JS makes it trivial.
- **Patch / customize** — it's plain Node + an editable Bun→Node shim now: monkeypatch
  behavior, change defaults, inject env, wrap commands, add logging.
- **Run under Node tooling** — `node --inspect`, profilers, coverage, custom loaders/require
  hooks, debuggers — to debug Claude Code itself or your integration.
- **Smaller footprint** — the de-bunned output (~30–40 MB) vs the ~220 MB binary (which embeds
  the whole Bun runtime and a ~130 MB sourcemap).
- **Reproducible / air-gapped installs** — `npx cc2node 2.1.185` builds a specific version
  deterministically; vendor it and run later with only Node, no Bun and no installer.
- **Locked-down machines** — where policy allows running approved Node but not arbitrary
  downloaded native binaries.
- **Multiple versions side by side** — keep several `cli.node22.js` and switch without
  reinstalling binaries.

> Native addons (`image-processor.node`, `audio-capture.node`, …) and `rg` are
> platform-specific, so build for the platform you'll run on (`--platform`). The de-bunned
> JavaScript core — the TUI, the API client, tools — is platform-independent and runs on any
> supported Node.

## Usage

```
cc2node <version|tarball|binary> [options]

Input:
  <version>            e.g. 2.1.185 — or "latest" / "stable".
                       Downloaded from downloads.claude.ai (falls back to GitHub, then npm).
  <tarball|binary>     a claude-*.tar.gz or an already-extracted Bun `claude` binary.

Options:
  -p, --platform <p>   target platform (default: this host)
                       linux-x64 | linux-x64-musl | linux-arm64 | linux-arm64-musl |
                       darwin-x64 | darwin-arm64
  -o, --out <dir>      output directory (default: ./cc2node-<version>-<platform>)
  -t, --targets <list> transpile targets (default: node18,node20,node22)
      --no-transpile   only emit the raw de-bunned cli.js
      --no-ripgrep     do not bundle ripgrep
      --no-install     do not npm install runtime deps into the output
      --keep-temp      keep the temp work dir
  -h, --help / -v, --version
```

### Which output file to run

| file | run it on |
| --- | --- |
| `cli.node18.js` | Node 18, 19 (also runs on any newer Node) |
| `cli.node20.js` | Node 20, 21 |
| `cli.node22.js` | Node 22+ (recommended for 24/25/26 too) |
| `cli.js` (raw)  | Node 24+ only (original bundle; uses `using`) |

The output dir also has `bun-shim.cjs`, the `*.node` addons, `rg`, a `package.json`, and a
`node_modules/` with `ws`, `undici`, `ajv`, `ajv-formats` (modules Bun provided natively).
Auth/config come from `~/.claude`, exactly like the official build.

## How it works

1. **Download** the Bun binary from `downloads.claude.ai/claude-code-releases/<version>/<platform>/claude`
   (SHA-256 verified via `manifest.json`); falls back to the GitHub release tarball, then npm.
2. **Unpack** the Bun standalone module graph at the end of the executable (`\n---- Bun! ----\n`
   trailer). Entries are validated by real module-name *and* content magic (`// @bun`,
   ELF/Mach-O/PE, `\0asm`), so it's robust against the decoy-filled sourcemap and needs no
   hard-coded offsets — version-independent.
3. **De-bun** `cli.js`: drop the `// @bun` directive, invoke the CommonJS wrapper Bun normally
   calls itself, and prepend `bun-shim.cjs` (a Node reimplementation of the `Bun.*` APIs the
   bundle uses). Reproduces a hand-verified reference port **byte-for-byte**.
4. **Transpile** with esbuild per Node target (lowering 390+ `using` declarations) and prepend
   idempotent polyfills (`Array.prototype.with`, …) so the Node 18/20 builds work.
5. **Assemble** addons, `rg` (ripgrep's static musl build on Linux), and `npm install` deps.

## Development

```sh
npm install
npm run lint          # biome lint + format check
npm run fix           # biome autofix + format
npm test              # convert the version set, run the build × Node matrix (test/run.js)
```

`test/run.js` converts each version (cached in `test/.cache/`) and runs every build under every
installed Node; CI (`.github/workflows/`) does the same across Node 18–26 on Linux.

### Releasing

Bump + tag with [`vbt`](https://www.npmjs.com/package/vbt); pushing the tag publishes to npm.

```sh
npm run release:patch   # vbt patch → bump package.json, commit, tag vX.Y.Z, push
```

The `publish` workflow runs the full Node 18–26 matrix on the tag and, only if it passes,
runs `npm publish` (set the `NPM_TOKEN` repo secret).

## License

MIT
