import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, NotFound } from '../exec.ts';
import { home } from '../home.ts';
import { EngineSkipped } from '../types.ts';

// Resolves to the package root from both src/php and dist/php.
const bundled = fileURLToPath(new URL('../../php-wasm/', import.meta.url));
const FILES = ['package.json', 'package-lock.json', 'php.mjs'];

let cached: Promise<string> | undefined;

export function resetPhpWasmCache(): void {
  cached = undefined;
}

const lastLine = (s: string): string => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';

async function install(note: (m: string) => void): Promise<string> {
  const hash = createHash('sha256');
  for (const f of ['package-lock.json', 'php.mjs']) hash.update(readFileSync(path.join(bundled, f)));
  const dir = path.join(home(), 'tools', `php-wasm-${hash.digest('hex').slice(0, 8)}`);
  const ready = path.join(dir, 'node_modules', '@php-wasm', 'node', 'package.json');
  if (existsSync(ready)) return dir;

  const npm = process.env.WP_SHAKEDOWN_NPM || 'npm';
  const noNpm = new EngineSkipped(
    'npm was not found. wp-shakedown uses it once to fetch the bundled PHP. Put npm on your PATH or set WP_SHAKEDOWN_NPM to its path.',
  );
  try {
    if ((await exec(npm, ['--version'])).code !== 0) throw noNpm;
  } catch (err) {
    throw err instanceof NotFound ? noNpm : err;
  }

  note('Installing the bundled PHP. This happens once and downloads about 160 MB.');
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const f of FILES) copyFileSync(path.join(bundled, f), path.join(tmp, f));
  // shortcut: npm runs without a shell, so npm.cmd on Windows is not found. Spawn through a shell there when Windows support is tested.
  const r = await exec(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: tmp });
  if (r.code !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`npm could not install the bundled PHP: ${lastLine(r.stderr) || lastLine(r.stdout)}`);
  }
  try {
    renameSync(tmp, dir);
  } catch {
    // Another process installed it first.
    rmSync(tmp, { recursive: true, force: true });
  }
  if (!existsSync(ready)) throw new Error(`npm finished, but the bundled PHP is not in "${dir}".`);
  return dir;
}

/** The folder that holds php.mjs and its node_modules. Installs it on first use. */
export function phpWasm(note: (m: string) => void): Promise<string> {
  if (!cached) {
    const p = install(note);
    cached = p;
    p.catch(() => {
      if (cached === p) cached = undefined;
    });
  }
  return cached;
}
