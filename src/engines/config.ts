import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Engine, RawFinding } from '../types.ts';

/** Removes PHP comments and leaves quoted strings alone, so a salt with // or # in it stays whole. */
function stripComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '#' || (c === '/' && text[i + 1] === '/')) {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
      out += ' ';
    } else out += c;
  }
  return out;
}

const SALTS = ['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'];
const FILE = { file: 'wp-config.php' };

export function configFindings(text: string): RawFinding[] {
  const code = stripComments(text);
  const define = (name: string): string | undefined => new RegExp(`define\\(\\s*['"]${name}['"]\\s*,\\s*(.+?)\\s*\\)\\s*;`, 's').exec(code)?.[1];
  const isOn = (v: string | undefined) => v !== undefined && /^(true|1)$/i.test(v);
  const out: RawFinding[] = [];
  if (isOn(define('WP_DEBUG'))) {
    out.push({ rule: 'config.debug', severity: 'warning', category: 'security', message: 'WP_DEBUG is on.', hint: 'Turn it off on a live site. Error output can reveal paths and code.', location: FILE });
  }
  const weak = SALTS.some((k) => {
    const v = define(k);
    if (v === undefined) return true;
    const m = /^(['"])([\s\S]*)\1$/.exec(v);
    return !!m && (m[2] === 'put your unique phrase here' || m[2]!.length < 32);
  });
  if (weak) {
    out.push({
      rule: 'config.salts', severity: 'error', category: 'security', message: 'The secret keys in wp-config.php are missing, short or still the default.',
      hint: 'Generate new ones at https://api.wordpress.org/secret-key/1.1/salt/ and paste them in.', location: FILE,
    });
  }
  if (!isOn(define('DISALLOW_FILE_EDIT'))) {
    out.push({
      rule: 'config.file-edit', severity: 'info', category: 'security', message: 'The theme and plugin editor in the dashboard is on.',
      hint: "Add define( 'DISALLOW_FILE_EDIT', true ); to wp-config.php.", location: FILE,
    });
  }
  return out;
}

const names = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch {
    return [];
  }
};

function uploadsPhp(root: string, dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) uploadsPhp(root, rel, out);
    else if (e.isFile() && /\.(php|phtml|phar)$/i.test(e.name)) {
      if (e.name.toLowerCase() === 'index.php' && statSync(path.join(root, rel)).size < 100) continue;
      out.push(rel);
    }
  }
}

export const config: Engine = {
  id: 'config',
  title: 'Configuration and risky files',
  kinds: ['install'],
  level: 2,
  async run({ target, note }) {
    const root = target.path;
    const out: RawFinding[] = [];
    const cfg = path.join(root, 'wp-config.php');
    if (!existsSync(cfg)) {
      note('No wp-config.php in this folder. Its settings were not checked.');
    } else {
      out.push(...configFindings(readFileSync(cfg, 'utf8')));
      if (process.platform !== 'win32' && statSync(cfg).mode & 0o002) {
        out.push({ rule: 'config.writable', severity: 'error', category: 'security', message: 'Every user on the machine can write to wp-config.php.', hint: 'Set its mode to 640 or 600.', location: FILE });
      }
    }
    const dump = /\.sql(\.gz|\.zip)?$/i;
    const add = (rule: string, severity: 'error' | 'warning', message: string, hint: string, file: string) =>
      out.push({ rule, severity, category: 'security', message, hint, location: { file } });
    for (const n of names(root)) {
      if (/^wp-config.*\.(bak|old|save|orig|txt|swp)$|^wp-config\.php~$/i.test(n)) add('leftover.config-copy', 'error', 'A copy of wp-config.php that a web server can send as plain text.', 'Delete it or move it out of the web folder.', n);
      else if (dump.test(n)) add('leftover.dump', 'error', 'A database dump in a web folder.', 'Delete it or move it out of the web folder.', n);
      else if (/^(phpinfo|info|adminer|installer|installer-backup)\.php$/i.test(n)) add('leftover.tool', 'warning', 'A setup or debug tool left in the web folder.', 'Delete it.', n);
      else if (n === '.env') add('leftover.env', 'warning', 'An .env file in the web folder.', 'Move it above the web folder or block it in the server config.', n);
    }
    for (const n of names(path.join(root, 'wp-content'))) {
      if (dump.test(n)) add('leftover.dump', 'error', 'A database dump in a web folder.', 'Delete it or move it out of the web folder.', `wp-content/${n}`);
    }
    if (existsSync(path.join(root, 'wp-content', 'debug.log'))) {
      add('leftover.debug-log', 'warning', 'wp-content/debug.log is readable from the web unless the server blocks it.', 'Delete it and turn off WP_DEBUG_LOG, or move the log.', 'wp-content/debug.log');
    }
    const php: string[] = [];
    uploadsPhp(root, 'wp-content/uploads', php);
    for (const file of php.slice(0, 50)) {
      add('uploads.php', 'error', 'A PHP file in the uploads folder.', 'Uploads should hold media only. Check the file: malware often hides here.', file);
    }
    if (php.length > 50) note(`${php.length} PHP files are in the uploads folder. The report lists the first 50.`);
    return out;
  },
};
