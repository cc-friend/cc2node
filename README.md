# cc2node

Convert **any Bun-compiled Claude Code release** into a pure-**Node** build that runs on
plain Node 18 / 20 / 22 / 24+ — no Bun runtime required.

Claude Code ≥ 2.1.112 ships as a [Bun](https://bun.sh) `--compile` single-file
executable. `cc2node` downloads that binary, unpacks the JavaScript + native addons
embedded inside it, "de-buns" the entry bundle so it runs under Node, and transpiles
Node 18/20/22 builds.

```sh
node bin/cc2node.js 2.1.185
# → ./cc2node-2.1.185-<platform>/  (cli.js, cli.node18/20/22.js, *.node, rg, node_modules)

node cc2node-2.1.185-*/cli.node22.js --version
# → 2.1.185 (Claude Code)
```

## Install

```sh
git clone <this repo> && cd cc2node
npm install            # one dependency: esbuild
node bin/cc2node.js --help
# or: npm link  →  cc2node 2.1.185
```

Runs on **Node ≥ 18** and old macOS/Linux (pure CommonJS; downloads over the built-in
`https`; only shells out to the universally-present `tar`).

## Usage

```
cc2node <version|tarball|binary> [options]

Input:
  <version>            e.g. 2.1.185 — downloaded from downloads.claude.ai
                       (falls back to GitHub releases, then npm)
  <tarball|binary>     a claude-*.tar.gz or an extracted Bun `claude` binary

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

### Output

| file | run it on |
| --- | --- |
| `cli.node18.js` | Node 18, 19 |
| `cli.node20.js` | Node 20, 21 |
| `cli.node22.js` | Node 22, 23 (also fine on 24+) |
| `cli.js` (raw)  | Node 24+ (uses `using` declarations) |

Plus `bun-shim.cjs`, the `*.node` native addons, `rg` (ripgrep), a `package.json`, and a
`node_modules/` with `ws`, `undici`, `ajv`, `ajv-formats` (the modules Bun provided
natively that the bundle imports). Auth/config come from `~/.claude`, like the official build.

## How it works

1. **Download** the Bun binary for the version+platform from the official installer
   source `downloads.claude.ai/claude-code-releases/<version>/<platform>/claude`
   (SHA-256 verified via the release `manifest.json`). Falls back to the GitHub
   release tarball, then the npm package.
2. **Unpack** the Bun standalone module graph appended at the end of the executable
   (terminated by the `\n---- Bun! ----\n` trailer). `cc2node` locates the modules
   array by validating candidate entries against real module-name *and* content magics
   (`// @bun`, ELF/Mach-O/PE, `\0asm`), so it is robust against the giant decoy-filled
   sourcemap that precedes it — and version-independent (no hard-coded offsets). This
   recovers `cli.js` (the bundle), the `image-processor.node` / `audio-capture.node`
   addons, and the version string.
3. **De-bun** `cli.js`: strip the `// @bun @bytecode @bun-cjs` directive, invoke the
   CommonJS wrapper Bun normally calls itself, and prepend `bun-shim.cjs` — a
   Node-side reimplementation of the ~20 `Bun.*` APIs the bundle uses (`spawn`,
   `which`, `stringWidth`, `wrapAnsi`, `semver`, `hash`, `YAML`, …) plus a redirect of
   `/$bunfs/root/*.node` requires to the sibling addons and a `bun:ffi` stub.
   This reproduces a hand-verified reference port **byte-for-byte**.
4. **Transpile** with esbuild to each Node target (lowering the 390+ `using` /
   `await using` declarations), prepending idempotent runtime polyfills
   (`Array.prototype.with` etc.) so the Node 18/20 builds work too.
5. **Assemble** the output dir: addons, `rg` (downloaded from ripgrep's releases —
   the static musl build on Linux for old-glibc compatibility), and `npm install` the
   runtime deps.

## Testing

```sh
node test/run.js                       # convert the default versions, run the full matrix
node test/run.js --quick               # just the first version
node test/run.js --versions 2.1.185 --platform darwin-x64
node test/run.js --nodes 18,22         # restrict the Node matrix
```

The harness converts each version (cached under `test/.cache/`) and runs every build
under every installed Node major (discovered from nvm), asserting `--version`. See the
build × Node compatibility matrix it prints.

## Limitations

- The `*.node` addons and `rg` are platform-specific; build for the platform you'll run on
  (`--platform`). The de-bunned JavaScript itself is platform-independent.
- `Bun.hash` is FNV (not wyhash), so caches written by the official binary regenerate;
  `Bun.YAML` is minimal; `bun:ffi` (keychain) is stubbed → credentials fall back to file
  storage. None affect normal operation. See `assets/bun-shim.cjs`.
