import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';

/** Limits that stop an archive from filling the disk. */
export interface UnzipLimits {
  maxFiles: number;
  maxBytes: number;
}

export const DEFAULT_LIMITS: UnzipLimits = { maxFiles: 20_000, maxBytes: 1024 ** 3 };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** A safe relative path inside the archive, or undefined for an entry to skip. Throws on a path that leaves the folder. */
function entryPath(raw: string): string | undefined {
  const name = raw.replace(/\\/g, '/');
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw new Error(`The archive holds an absolute path: "${raw}".`);
  const parts = name.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.includes('..')) throw new Error(`The archive holds a path that leaves the folder: "${raw}".`);
  // macOS adds resource forks under __MACOSX. They are not part of the theme.
  if (parts.length === 0 || parts[0] === '__MACOSX') return undefined;
  return parts.join('/');
}

/**
 * Unpacks a ZIP archive into `dest`, which must exist. Reads stored and deflated entries, the two methods
 * zip tools use for themes and plugins. Refuses encrypted, ZIP64 and damaged archives, paths that leave
 * `dest`, and archives over the limits. Skips symbolic links. Returns the paths it wrote, relative to `dest`.
 */
export function unzip(buf: Buffer, dest: string, limits: UnzipLimits = DEFAULT_LIMITS): string[] {
  const bad = (why: string): Error => new Error(`This is not a ZIP archive the tool can read: ${why}.`);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad('no end record');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw bad('ZIP64 archives are not supported');
  if (count > limits.maxFiles) throw new Error(`The archive holds ${count} files. The limit is ${limits.maxFiles}.`);

  const entries: { name: string; dir: boolean; method: number; crc: number; size: number; compSize: number; local: number }[] = [];
  let total = 0;
  let at = cdOffset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== CENTRAL) throw bad('a damaged directory');
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const compSize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const mode = buf.readUInt32LE(at + 38) >>> 16;
    const local = buf.readUInt32LE(at + 42);
    const raw = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw bad('it is encrypted');
    if ((mode & 0o170000) === 0o120000) continue;
    const name = entryPath(raw);
    if (name === undefined) continue;
    const dir = raw.endsWith('/') || raw.endsWith('\\');
    if (!dir && method !== 0 && method !== 8) throw bad(`"${raw}" uses compression method ${method}`);
    total += size;
    if (total > limits.maxBytes) throw new Error(`The archive unpacks to more than ${Math.round(limits.maxBytes / 1024 ** 2)} MB.`);
    entries.push({ name, dir, method, crc, size, compSize, local });
  }

  const root = path.resolve(dest);
  const written: string[] = [];
  for (const e of entries) {
    const target = path.resolve(root, e.name);
    if (!target.startsWith(root + path.sep)) throw new Error(`The archive holds a path that leaves the folder: "${e.name}".`);
    if (e.dir) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== LOCAL) throw bad(`"${e.name}" has no local header`);
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const data = buf.subarray(start, start + e.compSize);
    if (data.length !== e.compSize) throw bad(`"${e.name}" is cut short`);
    let out: Buffer;
    try {
      // maxOutputLength stops a file that inflates past the size its header gives.
      out = e.method === 0 ? data : inflateRawSync(data, { maxOutputLength: Math.max(e.size, 1) });
    } catch {
      throw bad(`"${e.name}" does not unpack`);
    }
    if (out.length !== e.size || crc32(out) !== e.crc) throw bad(`"${e.name}" fails its checksum`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, out);
    written.push(e.name);
  }
  return written;
}
