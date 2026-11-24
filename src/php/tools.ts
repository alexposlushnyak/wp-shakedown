import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, NotFound } from '../exec.ts';
import { home } from '../home.ts';
import { EngineSkipped } from '../types.ts';
import { phpVersion } from './php.ts';

// Resolves to the package root from both src/php and dist/php.
const bundled = fileURLToPath(new URL('../../php-tools/', import.meta.url));

let cached: Promise<string> | undefined;

export function resetToolsCache(): void {
  cached = undefined;
}

const lastLine = (s: string): string => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';

async function install(note: (m: string) => void): Promise<string> {
  const hash = createHash('sha256').update(readFileSync(path.join(bundled, 'composer.lock'))).digest('hex').slice(0, 8);
  const dir = path.join(home(), 'tools', `php-${hash}`);
  if (existsSync(path.join(dir, 'vendor', 'bin', 'phpcs'))) return dir;

  await phpVersion();
  const composer = process.env.WP_SHAKEDOWN_COMPOSER || 'composer';
  const noComposer = new EngineSkipped(
    'Composer is not installed. wp-shakedown uses it once to fetch PHPCS and the WordPress standards. Get it from https://getcomposer.org or set WP_SHAKEDOWN_COMPOSER to its path.',
  );
  try {
    if ((await exec(composer, ['--version'])).code !== 0) throw noComposer;
  } catch (err) {
    throw err instanceof NotFound ? noComposer : err;
  }

  note('Installing the PHP tools. This happens once.');
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const f of ['composer.json', 'composer.lock']) copyFileSync(path.join(bundled, f), path.join(tmp, f));
  // shortcut: composer runs without a shell, so composer.bat on Windows is not found. Spawn through a shell there when Windows support is tested.
  const r = await exec(composer, ['install', '--no-dev', '--no-interaction', '--no-progress', '--working-dir', tmp]);
  if (r.code !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`Composer could not install the PHP tools: ${lastLine(r.stderr) || lastLine(r.stdout)}`);
  }
  try {
    renameSync(tmp, dir);
  } catch {
    // Another process installed the tools first.
    rmSync(tmp, { recursive: true, force: true });
  }
  if (!existsSync(path.join(dir, 'vendor', 'bin', 'phpcs'))) {
    throw new Error(`Composer finished, but PHPCS is not in "${dir}".`);
  }
  return dir;
}

/** The folder that holds vendor/bin/phpcs. Installs it on first use. */
export function phpTools(note: (m: string) => void): Promise<string> {
  if (!cached) {
    const p = install(note);
    cached = p;
    p.catch(() => {
      if (cached === p) cached = undefined;
    });
  }
  return cached;
}
