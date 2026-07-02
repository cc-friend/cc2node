// Tiny stderr logger with elapsed-time stamps. Node 18+, no deps.
// All progress goes to stderr so stdout stays clean for piping.

export interface Logger {
  step(msg: string): void;
  info(msg: string): void;
  ok(msg: string): void;
  warn(msg: string): void;
  err(msg: string): void;
  raw(msg: string): void;
  reset(): void;
  c: Record<'dim' | 'green' | 'yellow' | 'red' | 'cyan' | 'bold', (s: unknown) => string>;
}

const useColor = process.stderr.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
function paint(code: string): (s: unknown) => string {
  return (s) => (useColor ? '\x1b[' + code + 'm' + s + '\x1b[0m' : String(s));
}
const dim = paint('2');
const green = paint('32');
const yellow = paint('33');
const red = paint('31');
const cyan = paint('36');
const bold = paint('1');

let t0 = Date.now();
function stamp(): string {
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  return dim('[' + (s.length < 5 ? ' ' : '') + s + 's]');
}
function line(sym: string, msg: string): void {
  process.stderr.write(stamp() + ' ' + sym + ' ' + msg + '\n');
}

const log: Logger = {
  step: (msg) => line(cyan('▶'), bold(msg)),
  info: (msg) => line(dim('·'), msg),
  ok: (msg) => line(green('✓'), msg),
  warn: (msg) => line(yellow('!'), yellow(msg)),
  err: (msg) => line(red('✗'), red(msg)),
  raw: (msg) => process.stderr.write(msg),
  reset: () => {
    t0 = Date.now();
  },
  c: { dim, green, yellow, red, cyan, bold }
};

export default log;
