import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import type { Target } from './types.ts';

const THEME_RE = /^[ \t\/*#@]*Theme Name:\s*(.+)$/im;
const PLUGIN_RE = /^[ \t\/*#@]*Plugin Name:\s*(.+)$/im;

function head(file: string): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, 8192, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The header value, without the comment end of a one-line header. */
function headerValue(re: RegExp, file: string): string | undefined {
  return re.exec(head(file))?.[1]?.replace(/\*\/\s*$/, '').trim() || undefined;
}

function themeName(dir: string): string | undefined {
  const css = path.join(dir, 'style.css');
  if (!isFile(css)) return undefined;
  return headerValue(THEME_RE, css);
}

function visible(dir: string): string[] {
  try {
    return readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  } catch {
    return [];
  }
}

/** First top-level PHP file with a Plugin Name header, in sorted order. */
function pluginName(dir: string): string | undefined {
  for (const n of visible(dir)) {
    const f = path.join(dir, n);
    if (!n.endsWith('.php') || !isFile(f)) continue;
    const name = headerValue(PLUGIN_RE, f);
    if (name) return name;
  }
  return undefined;
}

const DOMAIN_RE = /^[ \t/*#@]*Text Domain:(.*)$/im;

/** The Text Domain header of a theme or a plugin, or undefined. */
export function textDomain(target: Target): string | undefined {
  if (target.kind === 'theme') {
    const css = path.join(target.path, 'style.css');
    return isFile(css) ? headerValue(DOMAIN_RE, css) : undefined;
  }
  if (target.kind !== 'plugin') return undefined;
  if (isFile(target.path)) return headerValue(DOMAIN_RE, target.path);
  for (const n of visible(target.path)) {
    const f = path.join(target.path, n);
    if (n.endsWith('.php') && isFile(f) && headerValue(PLUGIN_RE, f)) return headerValue(DOMAIN_RE, f);
  }
  return undefined;
}

function discoverUnits(root: string): Target[] {
  const units: Target[] = [];
  // shortcut: reads wp-content at the install root and skips mu-plugins. Read WP_CONTENT_DIR from wp-config.php when someone has a relocated content folder.
  const themes = path.join(root, 'wp-content', 'themes');
  for (const n of visible(themes)) {
    const p = path.join(themes, n);
    if (!isDir(p)) continue;
    units.push({ kind: 'theme', path: p, name: themeName(p) ?? n, units: [] });
  }
  const plugins = path.join(root, 'wp-content', 'plugins');
  for (const n of visible(plugins)) {
    const p = path.join(plugins, n);
    if (isDir(p)) {
      units.push({ kind: 'plugin', path: p, name: pluginName(p) ?? n, units: [] });
    } else if (n.endsWith('.php') && isFile(p)) {
      const name = headerValue(PLUGIN_RE, p);
      if (name) units.push({ kind: 'plugin', path: p, name, units: [] });
    }
  }
  return units;
}

export function detectTarget(input: string, opts: { type?: 'theme' | 'plugin' | 'install' } = {}): Target {
  if (/^https?:\/\//.test(input)) {
    return { kind: 'url', path: input, name: new URL(input).host, units: [] };
  }
  const abs = path.resolve(input);
  if (!isDir(abs)) throw new Error(`"${input}" is not a folder.`);
  const base = path.basename(abs);

  let kind = opts.type;
  let name: string | undefined;
  if (!kind) {
    if (existsSync(path.join(abs, 'wp-includes', 'version.php'))) kind = 'install';
    else if ((name = themeName(abs))) kind = 'theme';
    else if ((name = pluginName(abs))) kind = 'plugin';
    else {
      throw new Error(
        `Cannot tell what "${input}" is. It has no wp-includes/version.php, no style.css with a Theme Name header and no PHP file with a Plugin Name header. Pass --type theme, --type plugin or --type install.`,
      );
    }
  }
  if (kind === 'install') return { kind, path: abs, name: base, units: discoverUnits(abs) };
  name ??= kind === 'theme' ? themeName(abs) : pluginName(abs);
  return { kind, path: abs, name: name ?? base, units: [] };
}
