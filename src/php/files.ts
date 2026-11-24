import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import path from 'node:path';

export function phpFiles(target: string): string[] {
  if (statSync(target).isFile()) return [target];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'vendor' && e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p);
      } else if (e.isFile() && e.name.endsWith('.php')) out.push(p);
    }
  };
  walk(target);
  return out.sort();
}

function head(file: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(8192);
    return buf.toString('utf8', 0, readSync(fd, buf, 0, 8192, 0));
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The "Requires PHP" header as major.minor, or undefined. */
export function requiresPhp(target: string): string | undefined {
  let files: string[];
  if (statSync(target).isFile()) files = [target];
  else {
    const top = readdirSync(target, { withFileTypes: true });
    const php = top.filter((e) => e.isFile() && e.name.endsWith('.php')).map((e) => e.name).sort();
    files = ['style.css', ...php, 'readme.txt'].map((n) => path.join(target, n));
  }
  for (const f of files) {
    const m = /^[ \t\/*#@]*Requires PHP:\s*(\d+)(\.\d+)?/im.exec(head(f));
    // "Requires PHP: 8" means 8.0.
    if (m) return `${m[1]}${m[2] ?? '.0'}`;
  }
  return undefined;
}
