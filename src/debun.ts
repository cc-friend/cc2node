/*
 * de-bun: turn the raw `cli.js` extracted from a Bun standalone binary into a file
 * that runs on plain Node — strip the `// @bun` directive, invoke the CJS wrapper
 * Bun would call itself, and prepend the Bun→Node compatibility shim.
 */
const WRAP_ARGS = '(module.exports, require, module, __filename, __dirname)';

export function debun(rawBundle: string | Buffer, shimSource: string, version: string): string {
  let bundle = Buffer.isBuffer(rawBundle) ? rawBundle.toString('utf8') : String(rawBundle);

  bundle = bundle.replace(/^﻿/, ''); // BOM
  bundle = bundle.replace(/^\/\/ ?@bun\b[^\n]*\r?\n/, ''); // Bun directive line
  bundle = bundle.replace(/^#![^\n]*\r?\n/, ''); // stray shebang
  bundle = bundle.replace(/\s+$/, ''); // trailing ws — expression ends with "})"

  let invoked: string;
  if (/^\(\s*function\b/.test(bundle) || /^\(\s*async\s+function\b/.test(bundle)) {
    invoked = bundle + WRAP_ARGS + ';\n';
  } else {
    invoked = '(function(exports, require, module, __filename, __dirname) {\n' + bundle + '\n})' + WRAP_ARGS + ';\n';
  }

  const banner =
    '#!/usr/bin/env node\n' +
    '// Claude Code ' +
    version +
    ' — de-bunned, runs on plain Node. Bun shim inlined below.\n';
  const begin = '\n;/* ---- begin ' + version + ' bundle (Bun CJS wrapper, now invoked) ---- */\n';

  return banner + shimSource.replace(/\s*$/, '\n') + begin + invoked;
}
