import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, NotFound } from './exec.ts';
import { home } from './home.ts';
import { EngineSkipped } from './types.ts';

/** A folder of the package with a package.json and a lock file, installed with npm into the tools folder on first use. */
export interface NpmToolsSpec {
  /** The folder in the package, such as `js-tools`. */
  folder: string;
  /** The files copied from that folder before `npm ci`. */
  files: string[];
  /** The files whose content names the install. A change makes a new install folder. */
  hashed: string[];
  /** The start of the install folder name, such as `js`. */
  prefix: string;
  /** A file that exists once the install worked, relative to the install folder. */
  ready: string;
  /** What npm fetches, for messages: `ESLint and Stylelint`. */
  what: string;
  /** The note shown while npm runs. */
  installing: string;
}

const lastLine = (s: string): string => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';

// Resolves to the package root from both src and dist.
const root = fileURLToPath(new URL('../', import.meta.url));

async function install(spec: NpmToolsSpec, note: (m: string) => void): Promise<string> {
  const bundled = path.join(root, spec.folder);
  const hash = createHash('sha256');
  for (const f of spec.hashed) hash.update(readFileSync(path.join(bundled, f)));
  const dir = path.join(home(), 'tools', `${spec.prefix}-${hash.digest('hex').slice(0, 8)}`);
  const ready = path.join(dir, spec.ready);
  if (existsSync(ready)) return dir;

  const npm = process.env.WP_SHAKEDOWN_NPM || 'npm';
  const noNpm = new EngineSkipped(
    `npm was not found. wp-shakedown uses it once to fetch ${spec.what}. Put npm on your PATH or set WP_SHAKEDOWN_NPM to its path.`,
  );
  try {
    if ((await exec(npm, ['--version'])).code !== 0) throw noNpm;
  } catch (err) {
    throw err instanceof NotFound ? noNpm : err;
  }

  note(spec.installing);
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const f of spec.files) copyFileSync(path.join(bundled, f), path.join(tmp, f));
  // shortcut: npm runs without a shell, so npm.cmd on Windows is not found. Spawn through a shell there when Windows support is tested.
  const r = await exec(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: tmp });
  if (r.code !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`npm could not install ${spec.what}: ${lastLine(r.stderr) || lastLine(r.stdout)}`);
  }
  try {
    renameSync(tmp, dir);
  } catch {
    // Another process installed it first.
    rmSync(tmp, { recursive: true, force: true });
  }
  if (!existsSync(ready)) throw new Error(`npm finished, but ${spec.what} is not in "${dir}".`);
  return dir;
}

/** The install folder of a set of npm tools, installed once and shared by every caller in the process. */
export function npmTools(spec: NpmToolsSpec): { get: (note: (m: string) => void) => Promise<string>; reset: () => void } {
  let cached: Promise<string> | undefined;
  return {
    get(note) {
      if (!cached) {
        const p = install(spec, note);
        cached = p;
        p.catch(() => {
          if (cached === p) cached = undefined;
        });
      }
      return cached;
    },
    reset() {
      cached = undefined;
    },
  };
}
