import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { home } from './home.ts';
import { detectTarget } from './target.ts';
import { unzip } from './zip.ts';
import type { UnzipLimits } from './zip.ts';

/** Where unpacked archives live. A theme stays at uploads/themes/<folder>, so a newer archive of it replaces the old one and the runs compare. */
export const uploadsDir = (): string => path.join(home(), 'uploads');

export const isUpload = (p: string): boolean => p.startsWith(uploadsDir() + path.sep);

const KIND_DIR = { theme: 'themes', plugin: 'plugins', install: 'sites', url: 'sites' } as const;

/**
 * Unpacks a theme, plugin or WordPress archive into the uploads folder and returns the folder to test.
 * `busy` says whether a folder is in use, so a run never has its files replaced under it.
 */
export function importZip(buf: Buffer, fileName: string, busy: (dir: string) => boolean = () => false, limits?: UnzipLimits): string {
  mkdirSync(uploadsDir(), { recursive: true });
  const tmp = path.join(uploadsDir(), `.tmp-${randomBytes(6).toString('hex')}`);
  mkdirSync(tmp);
  try {
    unzip(buf, tmp, limits);
    // Most archives hold one folder named after the slug. Without one, the archive name stands in for it.
    const top = readdirSync(tmp).filter((n) => !n.startsWith('.'));
    const single = top.length === 1 && statSync(path.join(tmp, top[0]!)).isDirectory() ? top[0]! : undefined;
    const from = single ? path.join(tmp, single) : tmp;
    const slug = single ?? path.basename(fileName).replace(/\.zip$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '');
    if (!slug) throw new Error('The archive needs a name.');
    const target = detectTarget(from);
    const dest = path.join(uploadsDir(), KIND_DIR[target.kind], slug);
    if (busy(dest)) throw new Error(`"${slug}" is running. Stop the run first.`);
    mkdirSync(path.dirname(dest), { recursive: true });
    rmSync(dest, { recursive: true, force: true });
    renameSync(from, dest);
    return dest;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Deletes an unpacked archive. Leaves any other folder alone. */
export function removeUpload(p: string): void {
  if (isUpload(p)) rmSync(p, { recursive: true, force: true });
}
