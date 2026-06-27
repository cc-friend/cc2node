'use strict';
// Tiny stderr logger with elapsed-time stamps. Node 18+, no deps.
// All progress goes to stderr so stdout stays clean for piping.

var useColor = process.stderr.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
function paint(code) {
  return function (s) { return useColor ? '[' + code + 'm' + s + '[0m' : String(s); };
}
var dim = paint('2'), green = paint('32'), yellow = paint('33'), red = paint('31'), cyan = paint('36'), bold = paint('1');

var t0 = Date.now();
function stamp() {
  var s = ((Date.now() - t0) / 1000).toFixed(1);
  return dim('[' + (s.length < 5 ? ' ' : '') + s + 's]');
}
function line(sym, msg) { process.stderr.write(stamp() + ' ' + sym + ' ' + msg + '\n'); }

module.exports = {
  step: function (msg) { line(cyan('▶'), bold(msg)); },
  info: function (msg) { line(dim('·'), msg); },
  ok: function (msg) { line(green('✓'), msg); },
  warn: function (msg) { line(yellow('!'), yellow(msg)); },
  err: function (msg) { line(red('✗'), red(msg)); },
  raw: function (msg) { process.stderr.write(msg); },
  reset: function () { t0 = Date.now(); },
  c: { dim: dim, green: green, yellow: yellow, red: red, cyan: cyan, bold: bold }
};
