import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Unreachable } from '../net.ts';
import { EngineSkipped } from '../types.ts';
import type { Target } from '../types.ts';

export function coreVersion(root: string): { version: string; locale: string } | undefined {
  let text: string;
  try {
    text = readFileSync(path.join(root, 'wp-includes', 'version.php'), 'utf8');
  } catch {
    return undefined;
  }
  const version = /\$wp_version\s*=\s*'([^']+)'/.exec(text)?.[1];
  if (!version) return undefined;
  return { version, locale: /\$wp_local_package\s*=\s*'([^']+)'/.exec(text)?.[1] ?? 'en_US' };
}

export interface Package {
  kind: 'plugin' | 'theme';
  slug: string;
  name: string;
  version?: string;
  path: string;
  file: string;
}

const PLUGIN_HEAD = /^[ \t\/*#@]*Plugin Name:/im;
const VERSION_HEAD = /^[ \t\/*#@]*Version:\s*(.+)$/im;

function head(file: string): string {
  try {
    return readFileSync(file).subarray(0, 8192).toString('utf8');
  } catch {
    return '';
  }
}

function pluginMain(dir: string): string | undefined {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.php')).sort();
  } catch {
    return undefined;
  }
  for (const n of names) {
    const f = path.join(dir, n);
    if (statSync(f, { throwIfNoEntry: false })?.isFile() && PLUGIN_HEAD.test(head(f))) return f;
  }
  return undefined;
}

export function packages(target: Target): Package[] {
  return target.units.map((u) => {
    const isFile = statSync(u.path, { throwIfNoEntry: false })?.isFile() ?? false;
    const main = u.kind === 'theme' ? path.join(u.path, 'style.css') : isFile ? u.path : pluginMain(u.path);
    const version = main ? VERSION_HEAD.exec(head(main))?.[1]?.replace(/\*\/\s*$/, '').trim() || undefined : undefined;
    return {
      kind: u.kind as 'plugin' | 'theme',
      slug: path.basename(u.path).replace(/\.php$/, ''),
      name: u.name,
      ...(version ? { version } : {}),
      path: u.path,
      file: path.relative(target.path, main ?? u.path).split(path.sep).join('/'),
    };
  });
}

/** Turns a lost connection into a skipped engine. */
export async function skipOnNetwork<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof Unreachable) throw new EngineSkipped(`${err.message} This engine needs the network.`);
    throw err;
  }
}
