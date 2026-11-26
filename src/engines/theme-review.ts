import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Category, Engine, EngineContext, Location, RawFinding, Severity } from '../types.ts';
import { walk } from './custom.ts';
import { latestWordPress } from './updates.ts';

const DOCS = 'https://github.com/alexposlushnyak/wp-shakedown/blob/main/docs/explanation/theme-review-feedback.md';
const MAX_FILE = 2 * 1024 * 1024;

export interface Theme {
  ctx: EngineContext;
  name: string;
  /** POSIX paths relative to the theme folder, sorted. */
  files: string[];
  /** The text of a file. Empty for a file over 2 MB. */
  read(file: string): string;
  /** A header of style.css, or undefined. */
  header(name: string): string | undefined;
  /** The text of readme.txt, undefined when the theme has none. */
  readme: string | undefined;
  isBlock: boolean;
  isChild: boolean;
}

export type Rule = (theme: Theme) => RawFinding[] | Promise<RawFinding[]>;

export function loadTheme(ctx: EngineContext): Theme {
  const { root, files } = walk(ctx.target);
  const cache = new Map<string, string>();
  const read = (file: string): string => {
    let text = cache.get(file);
    if (text === undefined) {
      const full = path.join(root, file);
      text = statSync(full).size > MAX_FILE ? '' : readFileSync(full, 'utf8');
      cache.set(file, text);
    }
    return text;
  };
  const head = files.includes('style.css') ? read('style.css').slice(0, 8192) : '';
  const header = (name: string): string | undefined => {
    const m = new RegExp(`^[ \\t/*#@]*${name}[ \\t]*:[ \\t]*(.*)$`, 'im').exec(head);
    const v = m?.[1]?.replace(/\*\/\s*$/, '').trim();
    return v ? v : undefined;
  };
  return {
    ctx,
    name: header('Theme Name') ?? ctx.target.name,
    files,
    read,
    header,
    readme: files.includes('readme.txt') ? read('readme.txt') : undefined,
    isBlock: files.includes('templates/index.html'),
    isChild: header('Template') !== undefined,
  };
}

/** The share of recent theme reviews that raised each rule. */
const SHARE: Record<string, number> = {
  'untranslated-text': 23,
  'text-in-template': 23,
  'readme-headers': 18,
  'tested-up-to': 13,
  'asset-licenses': 31,
  'skip-link': 13,
  'minified-without-source': 11,
  'pot-missing': 5,
  'placeholder-content': 7,
  'readme-copyright': 17,
  'link-underline': 10,
  'plugin-territory': 6,
  'customizer-textareas': 5,
  'footer-copyright': 4,
  'remote-fonts': 7,
  'demo-content': 4,
};

function make(rule: string, severity: Severity, category: Category, message: string, location: Location, fix: string): RawFinding {
  return { rule, severity, category, message, location, hint: `${fix} Reviewers raised this in about ${SHARE[rule]}% of recent theme reviews.`, docs: DOCS };
}

const phpFiles = (t: Theme): string[] => t.files.filter((f) => f.endsWith('.php'));
const ext = (f: string): string => path.posix.extname(f).slice(1).toLowerCase();
const dir = (f: string): string => (path.posix.dirname(f) === '.' ? '' : path.posix.dirname(f));
const isComment = (line: string): boolean => /^(\*|\/\/|#)/.test(line.trim());
const cut = (s: string, n = 40): string => (s.length > n ? `${s.slice(0, n)}...` : s);

/** Replaces every match with spaces and keeps the newlines, so line numbers stay right. */
const blank = (s: string, re: RegExp): string => s.replace(re, (m) => m.replace(/[^\n]/g, ' '));

/** The texts a visitor can read in a template, with their lines. Text in PHP blocks, comments, scripts and styles does not count. */
export function visibleTexts(source: string, kind: 'php' | 'html'): { line: number; text: string }[] {
  let s = source;
  if (kind === 'php') s = blank(s, /<\?(?:php|=)[\s\S]*?(?:\?>|$)/g);
  s = blank(s, /<!--[\s\S]*?(?:-->|$)/g);
  s = blank(s, /<(script|style)\b[\s\S]*?<\/\1\s*>/gi);
  const found: { index: number; text: string }[] = [];
  for (const m of s.matchAll(/>([^<>]*)</g)) found.push({ index: m.index + 1 + m[1]!.search(/\S|$/), text: m[1]! });
  for (const m of s.matchAll(/\b(?:alt|title|placeholder|aria-label)\s*=\s*"([^"]*)"/gi)) found.push({ index: m.index + m[0].indexOf('"') + 1, text: m[1]! });
  found.sort((a, b) => a.index - b.index);
  const out: { line: number; text: string }[] = [];
  for (const { index, text } of found) {
    if (!/\p{L}{3,}/u.test(text.replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, ' '))) continue;
    const line = s.slice(0, index).split('\n').length;
    if (out.length && out[out.length - 1]!.line === line) continue;
    out.push({ line, text: text.trim().replace(/\s+/g, ' ') });
  }
  return out;
}

/** Calls `fn` for each line of a file, leaving out comment lines when asked. */
function eachLine(text: string, fn: (line: string, n: number) => void, skipComments = false): void {
  text.split('\n').forEach((line, i) => {
    if (!skipComments || !isComment(line)) fn(line, i + 1);
  });
}

export const rules: Record<string, Rule> = {
  'untranslated-text': (t) =>
    phpFiles(t).flatMap((file) =>
      visibleTexts(t.read(file), 'php').map(({ line, text }) =>
        make('untranslated-text', 'warning', 'i18n', `The text "${cut(text)}" is not passed through a translation function.`, { file, line }, 'Wrap it in esc_html_e() or esc_attr_e() with the text domain of the theme.'),
      ),
    ),

  'text-in-template': (t) =>
    !t.isBlock
      ? []
      : t.files
          .filter((f) => f.endsWith('.html') && /^(templates|parts)\//.test(f))
          .flatMap((file) =>
            visibleTexts(t.read(file), 'html').map(({ line, text }) =>
              make('text-in-template', 'info', 'i18n', `The text "${cut(text)}" sits in an HTML template, where it cannot be translated.`, { file, line }, 'Move it into a PHP pattern and wrap it in a translation function.'),
            ),
          ),

  'readme-headers': (t) => {
    const fix = 'Follow the readme.txt format of the theme directory.';
    const out: RawFinding[] = [];
    const add = (message: string, line?: number): void => {
      out.push(make('readme-headers', 'warning', 'other', message, { file: 'readme.txt', ...(line ? { line } : {}) }, fix));
    };
    if (t.readme === undefined) {
      const wrong = t.files.find((f) => !f.includes('/') && /^readme\.(txt|md)$/i.test(f));
      if (wrong) out.push(make('readme-headers', 'warning', 'other', `The readme is named ${wrong}. Name it readme.txt.`, { file: wrong }, fix));
      return out;
    }
    const lines = t.readme.split(/\r?\n/);
    const first = lines.findIndex((l) => l.trim() !== '');
    if (first < 0 || !/^===\s*.+?\s*===\s*$/.test(lines[first]!)) add('readme.txt does not start with the theme name between === signs.', 1);
    const value = (name: string): string | undefined => {
      const m = new RegExp(`^${name}\\s*:\\s*(.*)$`, 'im').exec(t.readme!);
      return m ? m[1]!.trim() : undefined;
    };
    for (const name of ['Contributors', 'Requires at least', 'Tested up to', 'Requires PHP', 'License', 'License URI']) {
      if (value(name) === undefined) add(`readme.txt has no "${name}:" line.`);
    }
    for (const name of ['Requires at least', 'Tested up to', 'Requires PHP', 'License']) {
      const r = value(name);
      const s = t.header(name);
      // "GPLv2 or later" and "GNU General Public License v2 or later" name one license.
      const norm = (v: string): string => (name === 'License' ? v.toLowerCase().replace(/gnu\s+general\s+public\s+licen[sc]e/g, 'gpl').replace(/version/g, 'v').replace(/[^a-z0-9]/g, '') : v.toLowerCase());
      if (r !== undefined && s !== undefined && norm(r) !== norm(s)) add(`"${name}" is ${r} in readme.txt and ${s} in style.css. Use the same value in both.`);
    }
    if (!/^==\s*Changelog\s*==/im.test(t.readme)) add('readme.txt has no Changelog section.');
    return out;
  },

  'tested-up-to': async (t) => {
    const fromStyle = t.header('Tested up to');
    const file = fromStyle !== undefined ? 'style.css' : 'readme.txt';
    const value = fromStyle ?? (t.readme ? /^Tested up to\s*:\s*(.*)$/im.exec(t.readme)?.[1]?.trim() : undefined);
    const have = value ? /^(\d+)\.(\d+)/.exec(value) : null;
    if (!value || !have) return [];
    let latest: string | undefined;
    try {
      latest = await latestWordPress(t.ctx.signal);
    } catch {
      // The note below covers every way the service can fail.
    }
    const want = latest ? /^(\d+)\.(\d+)/.exec(latest) : null;
    if (!want) {
      t.ctx.note('Could not ask wordpress.org for the latest version, so the Tested up to rule was left out.');
      return [];
    }
    const older = Number(have[1]) < Number(want[1]) || (Number(have[1]) === Number(want[1]) && Number(have[2]) < Number(want[2]));
    if (!older) return [];
    return [make('tested-up-to', 'warning', 'compatibility', `Tested up to is ${value}. The latest WordPress is ${want[1]}.${want[2]}.`, { file }, 'Test the theme with the latest WordPress and update the header.')];
  },

  'asset-licenses': (t) => {
    if (t.readme === undefined) return [];
    const readme = t.readme.toLowerCase();
    const out: RawFinding[] = [];
    const fix = 'List each bundled image with its copyright holder, license and source URL. A line that names the folder covers every file in it.';
    const group = (exts: string[]): Map<string, string[]> => {
      const m = new Map<string, string[]>();
      for (const f of t.files) {
        if (!exts.includes(ext(f))) continue;
        m.set(dir(f), [...(m.get(dir(f)) ?? []), f]);
      }
      return m;
    };
    for (const [folder, files] of group(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'])) {
      const uncovered = files.filter((f) => {
        const name = path.posix.basename(f).toLowerCase();
        if (folder === '' && /^screenshot\./.test(name)) return false;
        const base = name.slice(0, name.length - path.posix.extname(name).length);
        return !((folder !== '' && readme.includes(folder.toLowerCase())) || readme.includes(name) || (base.length >= 4 && readme.includes(base)));
      });
      if (!uncovered.length) continue;
      const where = folder === '' ? 'the theme folder' : folder;
      const message = uncovered.length === 1 ? `1 image in ${where} is not listed in readme.txt.` : `${uncovered.length} images in ${where} are not listed in readme.txt.`;
      out.push(make('asset-licenses', 'warning', 'other', message, { file: uncovered[0]! }, fix));
    }
    const shot = t.files.find((f) => /^screenshot\.(png|jpg|jpeg|webp)$/i.test(f));
    if (shot && !readme.includes('screenshot')) {
      out.push(make('asset-licenses', 'warning', 'other', 'readme.txt does not say where the images in the screenshot come from.', { file: shot }, fix));
    }
    const licenses = new Set(t.files.filter((f) => /^(ofl|license|licence|copying)/i.test(path.posix.basename(f))).map(dir));
    for (const [folder, files] of group(['woff', 'woff2', 'ttf', 'otf'])) {
      if (licenses.has(folder) || licenses.has(dir(folder)) || (folder !== '' && readme.includes(folder.toLowerCase()))) continue;
      // "FiraSans-Bold.woff2" is covered by a readme that says "Fira Sans".
      const squashed = readme.replace(/[^a-z0-9]/g, '');
      const family = (f: string): string => path.posix.basename(f).split(/[-_.]/)[0]!.toLowerCase().replace(/[^a-z0-9]/g, '');
      const uncovered = files.filter((f) => family(f).length < 3 || !squashed.includes(family(f)));
      if (!uncovered.length) continue;
      out.push(
        make('asset-licenses', 'warning', 'other', `The fonts in ${folder === '' ? 'the theme folder' : folder} have no license file, and readme.txt does not list them.`, { file: uncovered[0]! }, 'Put the license file of the font next to it and name the font, its license and its source in readme.txt.'),
      );
    }
    return out;
  },

  'skip-link': (t) => {
    if (t.isChild) return [];
    if (t.isBlock) {
      const has = t.files.some((f) => f.endsWith('.html') && /^(templates|parts)\//.test(f) && /"tagName"\s*:\s*"main"/.test(t.read(f)));
      return has
        ? []
        : [make('skip-link', 'warning', 'accessibility', 'No template has a group with the tag name main, so WordPress adds no skip link.', { file: 'templates/index.html' }, 'Set the HTML element of the main content group to main.')];
    }
    const has = phpFiles(t).some((f) =>
      (t.read(f).match(/<a\b[^>]*>/gi) ?? []).some((tag) => /\bhref\s*=\s*["']#/i.test(tag) && /\bclass\s*=\s*["'][^"']*skip/i.test(tag)),
    );
    return has
      ? []
      : [make('skip-link', 'warning', 'accessibility', 'No skip link to the main content was found.', t.files.includes('header.php') ? { file: 'header.php' } : {}, 'Add a link right after wp_body_open() that points to the id of the main element.')];
  },

  'minified-without-source': (t) => {
    const names = new Set(t.files.map((f) => path.posix.basename(f)));
    return t.files
      .filter((f) => /\.min\.(js|css)$/.test(f) && !names.has(path.posix.basename(f).replace(/\.min\.(js|css)$/, '.$1')))
      .map((file) => make('minified-without-source', 'warning', 'other', `${file} has no readable source in the theme.`, { file }, 'Ship the original file next to it, or ship the file without minification.'));
  },

  'pot-missing': (t) => {
    const ready = /translation-ready/i.test(t.header('Tags') ?? '');
    if (!ready || t.files.some((f) => f.endsWith('.pot'))) return [];
    return [
      make('pot-missing', 'info', 'i18n', 'The theme has the tag translation-ready but no .pot file.', { file: 'style.css' }, `Generate one with: wp i18n make-pot . languages/${path.basename(t.ctx.target.path)}.pot`),
    ];
  },

  'placeholder-content': (t) => {
    const out: RawFinding[] = [];
    const fix = 'Demo content must not point at real people, and a link has to lead somewhere.';
    for (const file of t.files.filter((f) => /^(templates|parts|patterns)\//.test(f) && /\.(html|php)$/.test(f))) {
      const empty: number[] = [];
      eachLine(t.read(file), (line, n) => {
        if (/@author|@package|@link|@see/.test(line)) return;
        const email = [...line.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)].find((m) => !['example.com', 'example.org', 'example.net'].includes(m[1]!.toLowerCase()));
        if (email) out.push(make('placeholder-content', 'warning', 'other', `The address ${email[0]} looks real. Use a placeholder such as hello@example.com.`, { file, line: n }, fix));
        if ((line.match(/<a\b[^>]*\bhref\s*=\s*["']#["'][^>]*>/gi) ?? []).some((tag) => !/\brole\s*=\s*["']button["']/i.test(tag) && !/\baria-controls\b/i.test(tag))) {
          empty.push(n);
        }
      });
      // Patterns are full of these. One finding per file keeps the report readable.
      if (empty.length) {
        out.push(make('placeholder-content', 'info', 'other', empty.length === 1 ? 'A link points to "#".' : `${empty.length} links point to "#".`, { file, line: empty[0]! }, fix));
      }
    }
    return out;
  },

  'readme-copyright': (t) => {
    if (t.readme === undefined) return [];
    const out: RawFinding[] = [];
    const name = t.header('Theme Name');
    if (name && !t.readme.split('\n').some((l) => /(copyright|\(c\)|©)[^\n]{0,20}\d{4}/i.test(l) && l.toLowerCase().includes(name.toLowerCase()))) {
      out.push(
        make('readme-copyright', 'warning', 'other', 'readme.txt has no copyright notice that names the theme.', { file: 'readme.txt' }, `Add a line such as "${name} WordPress Theme, Copyright ${new Date().getFullYear()} ${t.header('Author') ?? 'the author'}".`),
      );
    }
    const license = t.files.find((f) => /^(license|licence)(\.txt|\.md)?$/i.test(f));
    if (license && !t.read(license).includes('TERMS AND CONDITIONS FOR COPYING')) {
      out.push(make('readme-copyright', 'info', 'other', `${license} does not hold the full text of the GPL.`, { file: license }, 'Use the full license text from gnu.org.'));
    }
    return out;
  },

  'link-underline': (t) => {
    if (!t.files.includes('theme.json')) return [];
    let json: any;
    try {
      json = JSON.parse(t.read('theme.json'));
    } catch {
      return [];
    }
    const own = json?.styles?.elements?.link?.typography?.textDecoration;
    const inContent = json?.styles?.blocks?.['core/post-content']?.elements?.link?.typography?.textDecoration;
    if (own !== 'none' || (inContent !== undefined && inContent !== 'none')) return [];
    return [make('link-underline', 'warning', 'accessibility', 'Links are not underlined (styles.elements.link in theme.json).', { file: 'theme.json' }, 'Underline links inside content, so they differ from the text by more than color.')];
  },

  'plugin-territory': (t) => {
    const patterns: [RegExp, string][] = [
      [/<meta\s+name=["']description/i, 'The theme prints a meta description. SEO metadata belongs in a plugin.'],
      [/<meta\s+property=["']og:/i, 'The theme prints Open Graph tags. Social metadata belongs in a plugin.'],
      [/application\/ld\+json/i, 'The theme prints structured data. That belongs in a plugin.'],
      [/\bwp_mail\s*\(/, 'The theme sends mail with wp_mail(). That belongs in a plugin.'],
      [/wp_ajax_nopriv_/, 'The theme registers an AJAX action for visitors who are not logged in. That belongs in a plugin.'],
      [/\bregister_rest_route\s*\(/, 'The theme registers a REST route. That belongs in a plugin.'],
    ];
    const out: RawFinding[] = [];
    for (const file of phpFiles(t)) {
      eachLine(
        t.read(file),
        (line, n) => {
          for (const [re, message] of patterns) if (re.test(line)) out.push(make('plugin-territory', 'warning', 'correctness', message, { file, line: n }, 'Move this into a plugin, or remove it.'));
        },
        true,
      );
    }
    return out;
  },

  'customizer-textareas': (t) => {
    let n = 0;
    for (const f of phpFiles(t)) n += (t.read(f).match(/['"]type['"]\s*=>\s*['"]textarea['"]|WP_Customize_Code_Editor_Control/g) ?? []).length;
    return n > 3
      ? [make('customizer-textareas', 'info', 'other', `The Customizer has ${n} textarea controls. Reviewers ask for three at most.`, {}, 'Keep content in the editor and use the Customizer for design options.')]
      : [];
  },

  'footer-copyright': (t) => {
    const names = [t.header('Theme Name'), t.header('Author')].filter((v): v is string => !!v && v.length >= 3).map((v) => v.toLowerCase());
    if (!names.length) return [];
    const out: RawFinding[] = [];
    const files = t.files.filter((f) => f === 'footer.php' || /^parts\/footer[^/]*\.html$/.test(f) || (/^patterns\//.test(f) && path.posix.basename(f).includes('footer')));
    for (const file of files) {
      eachLine(
        t.read(file),
        (line, n) => {
          const low = line.toLowerCase();
          if ((line.includes('©') || low.includes('&copy;') || low.includes('copyright')) && names.some((v) => low.includes(v))) {
            out.push(make('footer-copyright', 'warning', 'other', 'A copyright line names the theme or its author.', { file, line: n }, 'On a site the copyright belongs to the site. Use the site title, for example the Site Title block.'));
          }
        },
        true,
      );
    }
    return out;
  },

  'remote-fonts': (t) => {
    const out: RawFinding[] = [];
    for (const file of t.files.filter((f) => ['php', 'css', 'scss', 'html', 'json', 'js'].includes(ext(f)))) {
      eachLine(t.read(file), (line, n) => {
        const host = ['fonts.googleapis.com', 'fonts.gstatic.com', 'use.typekit.net', 'fonts.bunny.net'].find((h) => line.includes(h));
        if (host) out.push(make('remote-fonts', 'warning', 'other', `Fonts are loaded from ${host}.`, { file, line: n }, 'Bundle the font files in the theme.'));
      });
    }
    return out;
  },

  'demo-content': (t) => {
    const out: RawFinding[] = [];
    for (const file of phpFiles(t)) {
      eachLine(
        t.read(file),
        (line, n) => {
          if (line.includes('ocdi/') || /\bwp_insert_user\s*\(/.test(line) || /\bwp_create_category\s*\(/.test(line)) {
            out.push(make('demo-content', 'warning', 'correctness', 'The theme imports demo content or creates content of its own.', { file, line: n }, 'That belongs in a plugin. A theme must not add content to the site.'));
          }
        },
        true,
      );
    }
    return out;
  },
};

export const themeReview: Engine = {
  id: 'theme-review',
  title: 'Theme review feedback',
  kinds: ['theme'],
  level: 7,
  experimental: true,
  async run(ctx) {
    const theme = loadTheme(ctx);
    const out: RawFinding[] = [];
    const failed: unknown[] = [];
    for (const [id, rule] of Object.entries(rules)) {
      try {
        out.push(...(await rule(theme)));
      } catch (err) {
        failed.push(err);
        ctx.note(`The rule ${id} could not run: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failed.length === Object.keys(rules).length) throw failed[0];
    return out;
  },
};
