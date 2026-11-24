import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', 'vendor', 'bower_components', 'build', 'dist']);

/** Absolute paths of the files under `root` that end with one of `exts`, sorted. Minified files and skipped folders are left out. */
export function sourceFiles(root: string, exts: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.')) walk(full);
      } else if (e.isFile() && exts.some((x) => e.name.endsWith(x)) && !/\.min\.(js|css)$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  if (statSync(root).isDirectory()) walk(root);
  return out.sort();
}

/** True for built output: a very long line near the top, a source map comment, or a sibling .map file. */
export function isGenerated(file: string): boolean {
  try {
    if (existsSync(`${file}.map`)) return true;
    const fd = openSync(file, 'r');
    try {
      const size = statSync(file).size;
      const head = Buffer.alloc(Math.min(4096, size));
      readSync(fd, head, 0, head.length, 0);
      if (head.toString('utf8').split('\n').some((l) => l.length > 500)) return true;
      const len = Math.min(512, size);
      const tail = Buffer.alloc(len);
      readSync(fd, tail, 0, len, size - len);
      return tail.toString('utf8').includes('sourceMappingURL=');
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}
