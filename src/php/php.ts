import { realpathSync } from 'node:fs';
import path from 'node:path';
import { exec, NotFound } from '../exec.ts';
import type { ExecResult } from '../exec.ts';
import { EngineSkipped } from '../types.ts';
import { phpWasm } from './wasm.ts';

export function phpBinary(): string {
  return process.env.WP_SHAKEDOWN_PHP || 'php';
}

/** True when WP_SHAKEDOWN_PHP=bundled: PHP runs as WebAssembly that wp-shakedown downloads once. */
export const usesBundledPhp = (): boolean => process.env.WP_SHAKEDOWN_PHP === 'bundled';

/** The real path of an existing file or folder under bundled PHP, which cannot follow symlinks. Host PHP keeps the path as given. */
export const phpPath = (p: string): string => (usesBundledPhp() ? realpathSync(p) : p);

export const MISSING_PHP =
  'PHP is not installed. Put php on your PATH, set WP_SHAKEDOWN_PHP to its path, or set WP_SHAKEDOWN_PHP=bundled to use a PHP that wp-shakedown downloads once (about 160 MB).';

/** Runs `php <args>` with the PHP on the machine or the bundled one. */
export async function runPhp(args: string[], opts: { cwd?: string; signal?: AbortSignal; note: (m: string) => void }): Promise<ExecResult> {
  const run = { ...(opts.cwd ? { cwd: opts.cwd } : {}), ...(opts.signal ? { signal: opts.signal } : {}) };
  if (!usesBundledPhp()) return exec(phpBinary(), args, run);
  const dir = await phpWasm(opts.note);
  return exec(process.execPath, [path.join(dir, 'php.mjs'), ...args], run);
}

let cached: Promise<string> | undefined;

export function resetPhpCache(): void {
  cached = undefined;
}

async function detect(note: (m: string) => void): Promise<string> {
  const missing = new EngineSkipped(MISSING_PHP);
  try {
    const r = await runPhp(['-r', 'echo PHP_VERSION;'], { note });
    if (r.code !== 0) throw missing;
    return r.stdout.trim();
  } catch (err) {
    throw err instanceof NotFound ? missing : err;
  }
}

/** The PHP version, for example "8.4.25". Looked up once per process. */
export function phpVersion(note: (m: string) => void): Promise<string> {
  return (cached ??= detect(note));
}
