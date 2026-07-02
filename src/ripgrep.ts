/*
 * Fetch the ripgrep (`rg`) binary the Claude Code Grep/Glob tools shell out to.
 * Not embedded in the Bun binary — download it from ripgrep's GitHub releases and
 * drop it next to cli.js (the shim puts that dir on PATH). Linux uses the static
 * musl build so it runs on old glibc too.
 */
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { downloadTo } from './download';
import type { Logger } from './log';

export const RG_VERSION = '14.1.1';
const RG_BASE = 'https://github.com/BurntSushi/ripgrep/releases/download';

const TRIPLES: Record<string, string> = {
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-x64-musl': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-arm64-musl': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin'
};

export async function fetchRipgrep(platform: string, destPath: string, workDir: string, log: Logger): Promise<boolean> {
  const triple = TRIPLES[platform];
  if (!triple) {
    log.warn('no ripgrep build mapped for ' + platform + ' — skipping rg');
    return false;
  }

  const name = 'ripgrep-' + RG_VERSION + '-' + triple;
  const url = RG_BASE + '/' + RG_VERSION + '/' + name + '.tar.gz';
  const tgz = path.join(workDir, name + '.tar.gz');

  log.info('ripgrep ' + RG_VERSION + ' (' + triple + ')');
  await downloadTo(url, tgz, {});

  const outDir = path.join(workDir, name + '-x');
  fs.mkdirSync(outDir, { recursive: true });
  cp.execFileSync('tar', ['-xzf', tgz, '-C', outDir], { stdio: 'ignore' });

  let rg = path.join(outDir, name, 'rg');
  if (!fs.existsSync(rg)) {
    const found = findRg(outDir);
    if (!found) throw new Error('rg binary not found inside ripgrep archive');
    rg = found;
  }
  fs.copyFileSync(rg, destPath);
  try {
    fs.chmodSync(destPath, 0o755);
  } catch {
    /* ignore */
  }
  return true;
}

function findRg(root: string): string | null {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop() as string;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      const fp = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(fp);
      else if (ent.name === 'rg') return fp;
    }
  }
  return null;
}
