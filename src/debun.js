'use strict';
/*
 * de-bun: turn the raw `cli.js` extracted from a Bun standalone binary into a file
 * that runs on plain Node.
 *
 * The extracted entry looks like:
 *
 *     // @bun @bytecode @bun-cjs
 *     (function(exports, require, module, __filename, __dirname) { ...bundle... })
 *
 * i.e. a CommonJS module wrapped in a parenthesised function *expression* that Bun
 * invokes from inside its own loader. Under Node nothing calls it, so we:
 *   1. strip the leading `// @bun ...` directive line,
 *   2. invoke the wrapper ourselves with Node's CJS locals,
 *   3. prepend the Bun→Node compatibility shim (which installs globalThis.Bun and
 *      redirects `/$bunfs/root/*.node` requires to the sibling native addons).
 *
 * This reproduces, byte-for-byte, the hand-made reference port.
 */

var WRAP_ARGS = '(module.exports, require, module, __filename, __dirname)';

function debun(rawBundle, shimSource, version) {
  var bundle = Buffer.isBuffer(rawBundle) ? rawBundle.toString('utf8') : String(rawBundle);

  // 1) drop a UTF-8 BOM + the leading Bun directive line ("// @bun @bytecode @bun-cjs")
  bundle = bundle.replace(/^﻿/, '');
  bundle = bundle.replace(/^\/\/ ?@bun\b[^\n]*\r?\n/, '');
  // a stray shebang, if any (the entry normally has none)
  bundle = bundle.replace(/^#![^\n]*\r?\n/, '');
  // trailing whitespace/newline — the expression ends with "})"
  bundle = bundle.replace(/\s+$/, '');

  // 2) invoke the wrapper. Bun's @bun-cjs format is always a parenthesised function
  //    expression; if a future build isn't wrapped, wrap it so its top-level `var`s
  //    don't leak into the shim's scope.
  var invoked;
  if (/^\(\s*function\b/.test(bundle) || /^\(\s*async\s+function\b/.test(bundle)) {
    invoked = bundle + WRAP_ARGS + ';\n';
  } else {
    invoked = '(function(exports, require, module, __filename, __dirname) {\n' +
      bundle + '\n})' + WRAP_ARGS + ';\n';
  }

  // 3) assemble: shebang + banner + shim + invoked bundle
  var banner =
    '#!/usr/bin/env node\n' +
    '// Claude Code ' + version + ' — de-bunned, runs on plain Node. Bun shim inlined below.\n';
  var begin = '\n;/* ---- begin ' + version + ' bundle (Bun CJS wrapper, now invoked) ---- */\n';

  // normalise the shim to exactly one trailing newline; `begin` adds the blank
  // line before the bundle, matching the reference port byte-for-byte.
  return banner + shimSource.replace(/\s*$/, '\n') + begin + invoked;
}

module.exports = { debun: debun };
