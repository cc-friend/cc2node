// Sniff the Claude Code version from the bundled entry source ("// Version: x.y.z").
export function sniffVersion(source: string): string | null {
  const head = source.slice(0, 8192);
  const m = head.match(/\/\/ Version:\s*([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?)/);
  return m ? m[1] : null;
}
