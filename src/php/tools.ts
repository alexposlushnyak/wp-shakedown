import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, NotFound } from '../exec.ts';
import { home } from '../home.ts';
import { net } from '../net.ts';
import { EngineSkipped } from '../types.ts';
import { phpVersion, runPhp, usesBundledPhp } from './php.ts';

// Resolves to the package root from both src/php and dist/php.
const bundled = fileURLToPath(new URL('../../php-tools/', import.meta.url));

let cached: Promise<string> | undefined;

export function resetToolsCache(): void {
  cached = undefined;
}

// Read from https://getcomposer.org/versions and https://getcomposer.org/download/2.11.3/composer.phar.sha256sum.
export const COMPOSER_VERSION = '2.11.3';
export const COMPOSER_SHA256 = '04f8b003da4e3a2459056591fbfebd02b4dc3e5adeb158616b90cf55a65113ec';

/** Downloads composer.phar once, for a machine with only the bundled PHP. */
export async function composerPhar(): Promise<string> {
  const tools = path.join(home(), 'tools');
  const file = path.join(tools, `composer-${COMPOSER_VERSION}.phar`);
  if (existsSync(file)) return file;
  mkdirSync(tools, { recursive: true });
  const res = await net.fetch(`https://getcomposer.org/download/${COMPOSER_VERSION}/composer.phar`, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`Composer could not be downloaded: getcomposer.org answered ${res.status}.`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== COMPOSER_SHA256) throw new Error('The download of Composer did not match its checksum.');
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
  return file;
}

/** The folders of the PHPCS standards in vendor/composer/installed.json, as absolute paths. */
export function standardPaths(installedJson: string, composerDir: string): string[] {
  const data = JSON.parse(installedJson) as { packages?: { type?: string; 'install-path'?: string }[] };
  return (data.packages ?? [])
    .filter((p) => p.type === 'phpcodesniffer-standard' && p['install-path'])
    .map((p) => path.resolve(composerDir, p['install-path']!));
}

// The Composer plugin that registers the standards cannot run under the bundled PHP, so wp-shakedown does it.
async function registerStandards(dir: string, configDir: string, note: (m: string) => void): Promise<void> {
  const phpcs = path.join(configDir, 'vendor', 'squizlabs', 'php_codesniffer', 'bin', 'phpcs');
  const paths = standardPaths(readFileSync(path.join(configDir, 'vendor', 'composer', 'installed.json'), 'utf8'), path.join(dir, 'vendor', 'composer'));
  const r = await runPhp([phpcs, '--config-set', 'installed_paths', paths.join(',')], { cwd: configDir, note });
  if (r.code !== 0) throw new Error(`PHPCS could not register its standards: ${lastLine(r.stderr) || lastLine(r.stdout)}`);
}

async function checkStandards(dir: string, note: (m: string) => void): Promise<void> {
  const r = await runPhp([path.join(dir, 'vendor', 'squizlabs', 'php_codesniffer', 'bin', 'phpcs'), '-i'], { cwd: dir, note });
  for (const name of ['WordPress-Extra', 'PHPCompatibilityWP']) {
    if (!r.stdout.includes(name)) throw new Error(`The bundled PHP could not register the ${name} standard.`);
  }
}

const lastLine = (s: string): string => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';

async function install(note: (m: string) => void): Promise<string> {
  const hash = createHash('sha256').update(readFileSync(path.join(bundled, 'composer.lock'))).digest('hex').slice(0, 8);
  const bundledPhp = usesBundledPhp();
  const toolsDir = path.join(home(), 'tools');
  // The bundled PHP needs real paths, and the Composer files differ from the host ones, so the folder has its own name.
  if (bundledPhp) mkdirSync(toolsDir, { recursive: true });
  const dir = path.join(bundledPhp ? realpathSync(toolsDir) : toolsDir, `php-${hash}${bundledPhp ? '-wasm' : ''}`);
  if (existsSync(path.join(dir, 'vendor', 'bin', 'phpcs'))) return dir;

  await phpVersion(note);
  const composer = process.env.WP_SHAKEDOWN_COMPOSER || 'composer';
  const noComposer = new EngineSkipped(
    'Composer is not installed. wp-shakedown uses it once to fetch PHPCS and the WordPress standards. Get it from https://getcomposer.org or set WP_SHAKEDOWN_COMPOSER to its path.',
  );
  let phar = '';
  if (bundledPhp) {
    note(`Downloading Composer ${COMPOSER_VERSION}.`);
    phar = await composerPhar();
  } else {
    try {
      if ((await exec(composer, ['--version'])).code !== 0) throw noComposer;
    } catch (err) {
      throw err instanceof NotFound ? noComposer : err;
    }
  }

  note('Installing the PHP tools. This happens once.');
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const f of ['composer.json', 'composer.lock']) copyFileSync(path.join(bundled, f), path.join(tmp, f));
  // shortcut: composer runs without a shell, so composer.bat on Windows is not found. Spawn through a shell there when Windows support is tested.
  const args = ['install', '--no-dev', '--no-interaction', '--no-progress', '--working-dir', tmp];
  const r = bundledPhp ? await runPhp(['-d', 'memory_limit=-1', phar, ...args], { note }) : await exec(composer, args);
  if (r.code !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`Composer could not install the PHP tools: ${lastLine(r.stderr) || lastLine(r.stdout)}`);
  }
  // The standards are written for the final folder, so the config survives the rename below.
  if (bundledPhp) {
    try {
      await registerStandards(dir, tmp, note);
    } catch (err) {
      rmSync(tmp, { recursive: true, force: true });
      throw err;
    }
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
  if (bundledPhp) {
    try {
      await checkStandards(dir, note);
    } catch (err) {
      // A folder without the standards would pass the check at the top of this function on the next run.
      rmSync(dir, { recursive: true, force: true });
      throw err;
    }
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
