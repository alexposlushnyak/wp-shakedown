import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Engine, RawFinding } from '../types.ts';

const MAX_SIZE = 2 * 1024 * 1024;
const MAX_FILES = 20000;
const LONG_LINE = 5000;

const PHP_LIKE = /\.(php|phtml|php5|php7|phar|inc)$/i;
const IMAGE = /\.(jpe?g|png|gif|ico|webp|bmp|svg)$/i;
// Files that cannot run as PHP and often mention a PHP tag in text. Reading them would only cost time.
const TEXT_OR_BINARY = /\.(js|mjs|css|json|map|md|txt|html?|xml|ya?ml|lock|po|pot|mo|csv|woff2?|ttf|eot|otf|mp[34]|zip|gz|pdf)$/i;
// config already reports these in uploads.
const CONFIG_UPLOADS = /\.(php|phtml|phar)$/i;
// config reports these root files as leftover.tool.
const CONFIG_ROOT_TOOL = /^(phpinfo|info|adminer|installer|installer-backup)\.php$/i;
const CORE_ROOT = new Set([
  'index.php', 'wp-activate.php', 'wp-blog-header.php', 'wp-comments-post.php', 'wp-config.php', 'wp-config-sample.php', 'wp-cron.php',
  'wp-links-opml.php', 'wp-load.php', 'wp-login.php', 'wp-mail.php', 'wp-settings.php', 'wp-signup.php', 'wp-trackback.php', 'xmlrpc.php',
]);
const SHELL_NAME = /^(wso|c99|r57|alfa|b374k|adminer|filesman)([-_.]?v?\d[\w.]*)?$/i;
const SUPER = String.raw`\$_(?:GET|POST|REQUEST|COOKIE)\b|\$_SERVER\s*\[\s*['"]HTTP_`;
const NAMED = String.raw`(?<![\w$>:])`;
const CHR = String.raw`chr\s*\(\s*(?:0x[0-9a-f]+|\d+)\s*\)`;

const PREG_E = /preg_replace\s*\(\s*(['"])[^\w\s\\]((?:(?!\1).)*?)[^\w\s\\][imsxADSUXJu]*e[imsxADSUXJu]*\1\s*,/;
const OBFUSCATED: RegExp[] = [
  new RegExp(String.raw`${NAMED}eval\s*\([^;]{0,3000}?\b(?:base64_decode|gzinflate|gzuncompress|str_rot13|strrev)\s*\(`, 'i'),
  new RegExp(String.raw`${NAMED}assert\s*\([^;]{0,500}?\$_(?:GET|POST|REQUEST|COOKIE|SERVER|FILES)\b`, 'i'),
  PREG_E,
  new RegExp(String.raw`${NAMED}create_function\s*\([^;]{0,500}?\$_[A-Z]+\b`, 'i'),
  new RegExp(String.raw`(?:${CHR}\s*\.\s*){3,}${CHR}`, 'i'),
  /\$\{\s*(['"])(?:\\x[0-9a-f]{2}|\\[0-7]{3}){2,}/i,
];
const REMOTE: RegExp[] = [
  new RegExp(String.raw`${NAMED}(?:eval|include|include_once|require|require_once|system|shell_exec|passthru|exec|popen|proc_open)\s*\(?\s*@?\s*(?:(?:stripslashes|base64_decode|urldecode|trim)\s*\(\s*)?(?:${SUPER})`, 'i'),
  new RegExp(String.raw`\`[^\`\n]{0,40}(?:${SUPER})`),
];

/**
 * The text with comments blanked, and with the contents of strings that hold a call blanked when `calls` is set.
 * Security plugins keep malware signatures in comments and strings; only code may count. Offsets stay the same.
 */
function mask(text: string, calls: boolean): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|#(?!\[)[^\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, (m) => {
    const blank = (t: string): string => t.replace(/[^\n]/g, ' ');
    if (m[0] !== "'" && m[0] !== '"') return blank(m);
    return calls && m.includes('(') ? m[0] + blank(m.slice(1, -1)) + m[0] : m;
  });
}

const lineOf = (text: string, index: number): number => {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < index; i = text.indexOf('\n', i + 1)) n++;
  return n;
};

interface Entry {
  rel: string;
  abs: string;
}

/** Root files, then everything under wp-content except node_modules and .git. Symlinks are not followed. */
function collect(root: string): Entry[] {
  const out: Entry[] = [];
  const visit = (rel: string, deep: boolean): void => {
    let entries;
    try {
      entries = readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (deep && e.name !== 'node_modules' && e.name !== '.git') visit(r, true);
      } else if (e.isFile()) out.push({ rel: r, abs: path.join(root, r) });
    }
  };
  visit('', false);
  visit('wp-content', true);
  return out;
}

export const suspiciousFiles: Engine = {
  id: 'suspicious-files',
  title: 'Suspicious files',
  kinds: ['install'],
  level: 4,
  async run({ target, note }) {
    const out: RawFinding[] = [];
    const add = (rule: string, severity: 'error' | 'warning', message: string, hint: string, file: string, line?: number) =>
      out.push({ rule, severity, category: 'security', message, hint, location: line ? { file, line } : { file } });

    let scanned = 0;
    let tooBig = 0;
    let capped = false;
    for (const { rel, abs } of collect(target.path)) {
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      const inRoot = !rel.includes('/');
      const inUploads = rel.startsWith('wp-content/uploads/');
      const phpLike = PHP_LIKE.test(name);
      if (!phpLike && (inRoot || (inUploads ? !IMAGE.test(name) : TEXT_OR_BINARY.test(name)))) continue;
      if (inRoot && !phpLike) continue;

      if (phpLike) {
        const base = name.replace(/\.[^.]*$/, '').toLowerCase();
        const shell = SHELL_NAME.test(base) && !(base.startsWith('adminer') && (rel.startsWith('wp-content/plugins/') || (inRoot && CONFIG_ROOT_TOOL.test(name))));
        if (shell) add('webshell-name', 'error', 'The file name matches a known web shell.', 'Check the file. If you did not put it there, delete it and look for how it got in.', rel);
        if (name.startsWith('.')) add('hidden-php', 'warning', 'A PHP file with a name that starts with a dot.', 'Hidden PHP files do not show in a normal folder listing. Check what it does.', rel);
        if (inRoot && !CORE_ROOT.has(name) && !CONFIG_ROOT_TOOL.test(name)) {
          add('php-in-root', 'warning', 'A PHP file in the WordPress root that is not a core file.', 'Core has a fixed set of PHP files here. Check the file and delete it if nothing needs it.', rel);
        }
      }

      const size = statSync(abs, { throwIfNoEntry: false })?.size;
      if (size === undefined) continue;
      if (size > MAX_SIZE) {
        tooBig++;
        continue;
      }
      if (scanned >= MAX_FILES) {
        capped = true;
        break;
      }
      scanned++;
      let text: string;
      try {
        text = readFileSync(abs, 'latin1');
      } catch {
        continue;
      }
      const tag = /<\?(?:php|=)/i.test(text);
      if (!phpLike && !tag) continue;

      if (!phpLike && IMAGE.test(name)) {
        add('hidden-php', 'warning', 'A file with an image extension that holds PHP code.', 'Images do not hold PHP. A file like this is a common way to hide a shell. Delete it unless you know why it is there.', rel, lineOf(text, text.search(/<\?(?:php|=)/i)));
      }
      const code = mask(text, true);
      const uncommented = mask(text, false);
      const first = (res: RegExp[]): number => {
        for (const re of res) {
          // The /e pattern of preg_replace sits inside a string, so that rule reads strings too.
          const m = re.exec(re === PREG_E ? uncommented : code);
          if (m) return m.index;
        }
        return -1;
      };
      const ob = first(OBFUSCATED);
      if (ob >= 0) add('obfuscated-code', 'error', 'Code that hides what it runs.', 'Obfuscated PHP is the mark of malware. Replace the file with a clean copy and check how the site was changed.', rel, lineOf(text, ob));
      const rc = first(REMOTE);
      if (rc >= 0) add('remote-code', 'error', 'Code that runs input from the request.', 'A request must never reach eval, include or a shell command. Replace the file with a clean copy and check how the site was changed.', rel, lineOf(text, rc));

      if (text.length > LONG_LINE && !/(^|\/)(vendor|node_modules)\//.test(rel)) {
        let at = 0;
        for (const line of text.split('\n')) {
          if (line.length > LONG_LINE && !/data:[\w/+.-]+;base64,/.test(line) && line.replace(/[^A-Za-z0-9+/=]/g, '').length / line.length > 0.9) {
            add('long-encoded-string', 'warning', 'A line of more than 5000 characters that is mostly base64.', 'Malware often packs its payload into one long encoded string. Check what decodes and runs it.', rel, lineOf(text, at));
            break;
          }
          at += line.length + 1;
        }
      }
    }
    if (tooBig) note(`${tooBig} ${tooBig === 1 ? 'file is' : 'files are'} larger than 2 MB and ${tooBig === 1 ? 'was' : 'were'} not scanned.`);
    if (capped) note(`The scan stopped after ${MAX_FILES} files. Later files were not scanned.`);
    return out;
  },
};
