import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { body, close, stripComments } from '../php/source.ts';
import { MAX_LEVEL } from '../types.ts';
import type { Category, Directory, Engine, EngineContext, Location, RawFinding, Severity, TargetKind } from '../types.ts';
import { walk } from './custom.ts';
import { latestWordPress } from './updates.ts';

const DOCS = 'https://github.com/alexposlushnyak/wp-shakedown/blob/main/docs/explanation/theme-review-feedback.md';
const ENGINES_DOCS = 'https://github.com/alexposlushnyak/wp-shakedown/blob/main/docs/reference/engines.md#review';
const MAX_FILE = 2 * 1024 * 1024;

/** The theme or plugin a rule reads. */
export interface Subject {
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

type RuleFn = (subject: Subject) => RawFinding[] | Promise<RawFinding[]>;

export function loadSubject(ctx: EngineContext): Subject {
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

function make(rule: string, severity: Severity, category: Category, message: string, location: Location, fix: string, docs = DOCS): RawFinding {
  // Rules added after the study have no share to quote.
  const share = SHARE[rule];
  return { rule, severity, category, message, location, hint: share === undefined ? fix : `${fix} Reviewers raised this in about ${share}% of recent theme reviews.`, docs };
}

/** A body of PHP code the theme runs from a hook or a condition. `start` is its offset in `src`. */
interface Chunk {
  file: string;
  src: string;
  start: number;
  text: string;
}

const lineAt = (src: string, pos: number): number => src.slice(0, pos).split('\n').length;

const sources = new WeakMap<Subject, { file: string; src: string }[]>();
/** The PHP files of a theme without comments. */
function php(t: Subject): { file: string; src: string }[] {
  let s = sources.get(t);
  if (!s) sources.set(t, (s = phpFiles(t).map((file) => ({ file, src: stripComments(t.read(file)) }))));
  return s;
}

/** Every `function name(` body of the theme, by name. Methods count. */
const indexes = new WeakMap<Subject, Map<string, Chunk[]>>();
function functionIndex(t: Subject): Map<string, Chunk[]> {
  const cached = indexes.get(t);
  if (cached) return cached;
  const index = new Map<string, Chunk[]>();
  indexes.set(t, index);
  for (const { file, src } of php(t)) {
    for (const m of src.matchAll(/\bfunction\s+&?(\w+)\s*\(/g)) {
      const end = close(src, m.index + m[0].length - 1);
      if (end < 0) continue;
      const brace = /^\s*(?::\s*\??[\w\\|]+\s*)?\{/.exec(src.slice(end + 1));
      if (!brace) continue;
      const open = end + 1 + brace[0].length - 1;
      const stop = close(src, open);
      index.set(m[1]!, [...(index.get(m[1]!) ?? []), { file, src, start: open + 1, text: src.slice(open + 1, stop < 0 ? src.length : stop) }]);
    }
  }
  return index;
}

/** The code run by callbacks hooked to any of `hooks`: closures, arrow functions and named functions or methods of any file. */
function callbacks(t: Subject, hooks: string[]): Chunk[] {
  const index = functionIndex(t);
  const out: Chunk[] = [];
  for (const { file, src } of php(t)) {
    for (const m of src.matchAll(/\badd_(?:action|filter)\s*\(\s*(['"])([\w-]+)\1\s*,/g)) {
      if (!hooks.includes(m[2]!)) continue;
      const from = m.index + m[0].length;
      const rest = src.slice(from);
      let name: string | undefined;
      const str = /^\s*(['"])([\\\w]+)\1/.exec(rest);
      const arr = /^\s*(?:array\s*\(|\[)([^\])]*)[\])]/.exec(rest);
      if (str) name = str[2]!.split('\\').pop();
      else if (arr) name = /(['"])(\w+)\1\s*$/.exec(arr[1]!)?.[2];
      if (name) {
        out.push(...(index.get(name) ?? []));
        continue;
      }
      const closure = /^\s*(?:static\s+)?function\s*&?\s*\(/.exec(rest);
      if (closure) {
        const params = close(src, from + closure[0].length - 1);
        const open = params < 0 ? -1 : src.indexOf('{', params);
        const stop = open < 0 ? -1 : close(src, open);
        if (open >= 0) out.push({ file, src, start: open + 1, text: src.slice(open + 1, stop < 0 ? src.length : stop) });
      } else if (/^\s*(?:static\s+)?fn\s*\(/.test(rest)) {
        const stop = close(src, src.indexOf('(', m.index));
        out.push({ file, src, start: from, text: src.slice(from, stop < 0 ? src.length : stop) });
      }
    }
  }
  return out;
}

/** The bodies of `if` statements whose condition matches `cond`. */
function guarded(t: Subject, cond: RegExp): Chunk[] {
  const out: Chunk[] = [];
  for (const { file, src } of php(t)) {
    for (const m of src.matchAll(/\bif\s*\(/g)) {
      const open = m.index + m[0].length - 1;
      const end = close(src, open);
      if (end < 0 || !cond.test(src.slice(open, end + 1))) continue;
      const text = body(src, end + 1);
      out.push({ file, src, start: src.indexOf(text, end + 1), text });
    }
  }
  return out;
}

/** Lines of a chunk that match `re`, as findings keyed by file and line so one line is reported once. */
function hits(chunks: Chunk[], re: RegExp): { file: string; line: number; match: string }[] {
  const seen = new Set<string>();
  const out: { file: string; line: number; match: string }[] = [];
  for (const c of chunks) {
    for (const m of c.text.matchAll(re)) {
      const line = lineAt(c.src, c.start + m.index);
      if (seen.has(`${c.file}:${line}`)) continue;
      seen.add(`${c.file}:${line}`);
      out.push({ file: c.file, line, match: m[0] });
    }
  }
  return out;
}

const isDemoLine = (line: string): boolean => line.includes('ocdi/') || /\bwp_insert_user\s*\(/.test(line) || /\bwp_create_category\s*\(/.test(line);

const SITE_DATA =
  /\b(?:wp_insert_post|wp_insert_term|wp_create_nav_menu|wp_update_nav_menu_item|wp_insert_attachment|media_sideload_image|media_handle_sideload|download_url|wp_set_object_terms)\s*\(|\b(?:update|add)_option\s*\(\s*(['"])(?:sidebars_widgets|show_on_front|page_on_front|page_for_posts|nav_menu_locations|widget_[\w-]+)\1|\bset_theme_mod\s*\(\s*(['"])nav_menu_locations\2|\bWP_Font_Library\b/g;
const REDIRECT = /\bwp_(?:safe_)?redirect\s*\(/g;

const phpFiles = (t: Subject): string[] => t.files.filter((f) => f.endsWith('.php'));
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

// A bare "license" or "activated" is too common: license.txt files, the ?activated=true redirect after a theme switch.
const LICENSE = /purchase[_-]?code|licen[sc]e[_-]?(?:is[_-]?)?(?:key|code|status|valid|active|activated|check|data|state)|(?:is|has|check|verify|validate)_?licen[sc]e|is_activated|is_registered|activation_status|envato_api|envato_token|verify_purchase/i;
const GATE = /\b(?:return|exit|die|require|require_once|include|include_once)\b|\b(?:wp_die|remove_action|remove_filter|deactivate_plugins|switch_theme|register_block_type|register_post_type|register_taxonomy|add_theme_support|add_shortcode)\s*\(/;
const HOOK = /\badd_(?:action|filter)\s*\(\s*(?:(['"])([^'"]*)\1)?/g;
const NOTICES = new Set(['admin_notices', 'network_admin_notices', 'all_admin_notices']);

/** Blanks code that does not run when the body runs: notice hooks and function bodies. */
function blankInert(b: string): string {
  let s = b;
  for (const m of [...s.matchAll(HOOK)]) {
    if (!NOTICES.has(m[2] ?? '')) continue;
    const open = s.indexOf('(', m.index);
    const end = close(s, open);
    s = s.slice(0, m.index) + ' '.repeat((end < 0 ? s.length : end + 1) - m.index) + s.slice(end < 0 ? s.length : end + 1);
  }
  for (let m = /\bfunction\b[^{;]*\{/.exec(s); m; m = /\bfunction\b[^{;]*\{/.exec(s)) {
    const open = m.index + m[0].length - 1;
    const end = close(s, open);
    s = s.slice(0, m.index) + ' ' + s.slice(end < 0 ? s.length : end + 1);
  }
  return s;
}

function gated(b: string): boolean {
  const s = blankInert(b);
  return GATE.test(s) || [...s.matchAll(HOOK)].length > 0;
}

function isGenerated(file: string, text: string): boolean {
  return file.endsWith('.min.php') || text.slice(0, 4096).split('\n').some((l) => l.length > 500);
}

/** Findings of the rule `features-locked` in one PHP source. */
export function lockedFeatures(source: string, file: string): RawFinding[] {
  const s = stripComments(source);
  const out: RawFinding[] = [];
  for (const m of s.matchAll(/\b(?:else\s*)?if\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const end = close(s, open);
    if (end < 0) continue;
    const cond = s.slice(open, end + 1);
    if (!LICENSE.test(cond) && !(/item_id/i.test(cond) && /envato/i.test(cond))) continue;
    if (!gated(body(s, end + 1))) continue;
    out.push(
      make('features-locked', 'warning', 'correctness', 'Features run only after activation with a purchase code or license key.', { file, line: lineAt(s, m.index) }, 'Show a notice about the missing activation and keep every feature working without it.', ENGINES_DOCS),
    );
  }
  return out;
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong']);

interface Family {
  name: string;
  slug: string;
  stack: string;
  hasFace: boolean;
  faces: string[];
}

function families(data: unknown): Family[] {
  const list = (data as { settings?: { typography?: { fontFamilies?: unknown } } } | null)?.settings?.typography?.fontFamilies;
  // Core also accepts { theme: [...] }, which is what a variation of a theme with custom origins can write.
  const items = Array.isArray(list) ? list : Array.isArray((list as { theme?: unknown } | undefined)?.theme) ? (list as { theme: unknown[] }).theme : [];
  const out: Family[] = [];
  for (const f of items as Record<string, unknown>[]) {
    if (!f || typeof f !== 'object') continue;
    const faces: string[] = [];
    for (const face of Array.isArray(f.fontFace) ? (f.fontFace as { src?: unknown }[]) : []) {
      const src = face?.src;
      for (const s of Array.isArray(src) ? src : [src]) if (typeof s === 'string') faces.push(s);
    }
    out.push({
      name: typeof f.name === 'string' ? f.name : String(f.slug ?? ''),
      slug: typeof f.slug === 'string' ? f.slug : '',
      stack: typeof f.fontFamily === 'string' ? f.fontFamily : '',
      hasFace: Array.isArray(f.fontFace) && f.fontFace.length > 0,
      faces,
    });
  }
  return out;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function lineOf(raw: string, needle: string): number | undefined {
  const i = raw.indexOf(`"${needle}"`);
  return i < 0 ? undefined : raw.slice(0, i).split('\n').length;
}

const fontCache = new WeakMap<Subject, RawFinding[]>();
/** The findings of the three font rules. One pass over theme.json and its style variations serves all three. */
function fontFindings(t: Subject): RawFinding[] {
  const cached = fontCache.get(t);
  if (cached) return cached;
  const out: RawFinding[] = [];
  fontCache.set(t, out);
  if (!t.files.includes('theme.json')) return out;
  const loaded: { rel: string; raw: string; data: unknown }[] = [];
  for (const rel of t.files.filter((f) => f === 'theme.json' || (f.startsWith('styles/') && f.endsWith('.json')))) {
    const raw = t.read(rel);
    try {
      loaded.push({ rel, raw, data: JSON.parse(raw) });
    } catch {
      // wp-json reports the syntax error.
    }
  }
  // One text to search for selections: every styles block, then templates, parts and patterns.
  const corpus = [
    ...loaded.map((l) => JSON.stringify((l.data as { styles?: unknown } | null)?.styles ?? null)),
    ...t.files.filter((f) => (/^(templates|parts)\/.*\.html$/.test(f)) || (/^patterns\/.*\.php$/.test(f))).map((f) => t.read(f)),
  ].join('\n');
  const selected = (slug: string): boolean => slug !== '' && new RegExp(`--wp--preset--font-family--${escapeRe(slug)}(?![\\w-])|preset\\|font-family\\|${escapeRe(slug)}(?![\\w-])`).test(corpus);
  const readme = t.readme === undefined ? [] : t.readme.split(/\r?\n/);
  const seen = new Set<string>();
  const add = (key: string, f: RawFinding): void => {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  };
  for (const { rel, raw, data } of loaded) {
    for (const fam of families(data)) {
      for (const src of fam.faces) {
        if (!src.startsWith('file:./') || t.files.includes(src.slice(7))) continue;
        const line = lineOf(raw, src);
        add(`1\n${rel}\n${src}`, make('font-file-missing', 'warning', 'correctness', `theme.json loads ${src}, and the theme has no such file.`, { file: rel, ...(line ? { line } : {}) }, 'Add the font file or fix the path. Without it the site falls back to another font.', ENGINES_DOCS));
      }
      // System stacks often end with emoji fonts after sans-serif, so any generic entry is a fallback.
      const fallback = fam.stack.split(',').some((e) => GENERIC.has(e.trim().replace(/^['"]|['"]$/g, '').toLowerCase()));
      if (!fam.hasFace && !fallback && selected(fam.slug)) {
        add(`2\n${rel}\n${fam.slug}`, make('font-family-unloaded', 'warning', 'correctness', `The font "${fam.name}" is selected but never loaded, and its stack has no fallback.`, { file: rel }, 'Add a fontFace with the font files, or end the stack with a generic family such as sans-serif.', ENGINES_DOCS));
      }
      if (readme.length > 0 && fam.faces.some((s) => s.startsWith('file:./'))) {
        const name = fam.name.toLowerCase();
        const hits = readme.flatMap((l, i) => (name !== '' && l.toLowerCase().includes(name) ? [i] : []));
        if (hits.length > 0 && !hits.some((i) => /https?:\/\//.test(`${readme[i]}\n${readme[i + 1] ?? ''}`))) {
          add(`3\n${fam.slug}`, make('font-source-missing', 'info', 'other', `readme.txt names the font "${fam.name}" without the URL of its source.`, { file: 'readme.txt', line: hits[0]! + 1 }, 'Add the URL where the font comes from, for example its page on fonts.google.com, next to its license.', ENGINES_DOCS));
        }
      }
    }
  }
  return out;
}

const checks: Record<string, RuleFn> = {
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
      .map((file) => make('minified-without-source', 'warning', 'other', `${file} has no readable source in the ${t.ctx.target.kind}.`, { file }, 'Ship the original file next to it, or ship the file without minification.'));
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
          if (isDemoLine(line)) {
            out.push(make('demo-content', 'warning', 'correctness', 'The theme imports demo content or creates content of its own.', { file, line: n }, 'That belongs in a plugin. A theme must not add content to the site.'));
          }
        },
        true,
      );
    }
    return out;
  },

  'creates-site-data': (t) => {
    const chunks = [
      ...callbacks(t, ['after_switch_theme', 'after_setup_theme']),
      ...guarded(t, /!\s*get_option\s*\(\s*(['"])[^'"]*_(?:installed|setup|imported|activated)\1/),
    ];
    const lines = new Map(php(t).map((p) => [p.file, p.src.split('\n')]));
    return hits(chunks, SITE_DATA)
      .filter((h) => !isDemoLine(lines.get(h.file)![h.line - 1] ?? ''))
      .map((h) => make('creates-site-data', 'warning', 'correctness', 'The theme creates site content or settings when it is activated.', { file: h.file, line: h.line }, 'Ask first: show a notice with a button that runs the setup, and leave the site as it was until the user agrees.'));
  },

  'activation-redirect': (t) => {
    const chunks = [...callbacks(t, ['after_switch_theme']), ...guarded(t, /\$_GET\s*\[\s*['"]activated['"]\s*\]/)];
    return hits(chunks, REDIRECT).map((h) =>
      make('activation-redirect', 'warning', 'correctness', 'The theme redirects the user after activation.', { file: h.file, line: h.line }, 'Stay on the themes screen. Show a dismissible notice that links to your welcome page instead.'),
    );
  },

  'notice-not-dismissible': (t) => {
    const out: RawFinding[] = [];
    const seen = new Set<string>();
    for (const c of callbacks(t, ['admin_notices', 'all_admin_notices', 'network_admin_notices'])) {
      // A word "dismiss" outside the is-dismissible class means a handler, as in a button or a script.
      if (/dismiss/i.test(c.text.replace(/is-dismissible/g, ''))) continue;
      for (const m of c.text.matchAll(/class\s*=\s*\\?["']([^"'\\]*)\\?["']/g)) {
        const classes = m[1]!.split(/\s+/);
        if (!classes.some((k) => ['notice', 'updated', 'error'].includes(k)) || classes.includes('is-dismissible')) continue;
        const line = lineAt(c.src, c.start + m.index);
        if (seen.has(`${c.file}:${line}`)) continue;
        seen.add(`${c.file}:${line}`);
        out.push(make('notice-not-dismissible', 'warning', 'other', 'An admin notice cannot be dismissed.', { file: c.file, line }, 'Add the is-dismissible class and remember the choice, so the notice does not return on every screen.'));
        break;
      }
    }
    return out;
  },

  'readme-not-english': (t) => {
    if (t.readme === undefined) return [];
    const text = t.readme.replace(/https?:\/\/\S+/g, ' ').replace(/```[\s\S]*?```|`[^`\n]*`/g, ' ').replace(/^(?: {4}|\t).*$/gm, ' ');
    const letters = text.match(/\p{L}/gu) ?? [];
    if (!letters.length) return [];
    const foreign = letters.filter((c) => c.charCodeAt(0) > 127).length / letters.length > 0.3;
    const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
    const common = new Set(['the', 'and', 'of', 'to', 'a', 'in', 'is', 'for', 'with', 'this', 'that', 'theme', 'you']);
    // Plain English text is about a quarter common words. German and Spanish stay under a tenth.
    const sparse = words.length >= 80 && words.filter((w) => common.has(w)).length / words.length < 0.1;
    if (!foreign && !sparse) return [];
    return [make('readme-not-english', 'info', 'other', 'readme.txt is not in English.', { file: 'readme.txt' }, 'Write readme.txt in English. The directory shows it as it is.')];
  },

  'font-file-missing': (t) => fontFindings(t).filter((f) => f.rule === 'font-file-missing'),
  'font-family-unloaded': (t) => fontFindings(t).filter((f) => f.rule === 'font-family-unloaded'),
  'font-source-missing': (t) => fontFindings(t).filter((f) => f.rule === 'font-source-missing'),

  'features-locked': (t) =>
    phpFiles(t).flatMap((file) => {
      const text = t.read(file);
      return isGenerated(file, text) ? [] : lockedFeatures(text, file);
    }),
};

const THEME: TargetKind[] = ['theme'];
const BOTH: TargetKind[] = ['theme', 'plugin'];
const WPORG: Directory[] = ['wporg'];
const BOTH_DIRECTORIES: Directory[] = ['wporg', 'envato'];

/** When a rule applies. A rule without `directories` applies to every run at its level. */
interface Applies {
  kinds: readonly TargetKind[];
  /** The lowest level that runs the rule. */
  level: number;
  /** The directories whose requirements the rule states. It runs for one of them, or at level 10. */
  directories?: readonly Directory[];
}

const applies: Record<string, Applies> = {
  'font-file-missing': { kinds: THEME, level: 3 },
  'font-family-unloaded': { kinds: THEME, level: 3 },
  'font-source-missing': { kinds: THEME, level: 7, directories: WPORG },
  'creates-site-data': { kinds: THEME, level: 5 },
  'notice-not-dismissible': { kinds: BOTH, level: 5 },
  'minified-without-source': { kinds: BOTH, level: 5 },
  'placeholder-content': { kinds: THEME, level: 5 },
  'features-locked': { kinds: BOTH, level: 7, directories: BOTH_DIRECTORIES },
  'asset-licenses': { kinds: THEME, level: 7, directories: BOTH_DIRECTORIES },
  'plugin-territory': { kinds: THEME, level: 7, directories: BOTH_DIRECTORIES },
  'untranslated-text': { kinds: THEME, level: 7, directories: BOTH_DIRECTORIES },
  ...Object.fromEntries(
    [
      'text-in-template',
      'readme-headers',
      'tested-up-to',
      'skip-link',
      'pot-missing',
      'readme-copyright',
      'link-underline',
      'customizer-textareas',
      'footer-copyright',
      'remote-fonts',
      'demo-content',
      'activation-redirect',
      'readme-not-english',
    ].map((id) => [id, { kinds: THEME, level: 7, directories: WPORG }]),
  ),
};

export interface Rule extends Applies {
  id: string;
  run: RuleFn;
}

export const rules: Record<string, Rule> = Object.fromEntries(Object.entries(checks).map(([id, run]) => [id, { id, ...applies[id]!, run }]));

export function ruleApplies(rule: Applies, ctx: Pick<EngineContext, 'target' | 'level' | 'directory'>): boolean {
  if (!rule.kinds.includes(ctx.target.kind) || rule.level > ctx.level) return false;
  return !rule.directories || ctx.level === MAX_LEVEL || (ctx.directory !== undefined && rule.directories.includes(ctx.directory));
}

export const review: Engine = {
  id: 'review',
  title: 'Review rules',
  kinds: ['theme', 'plugin'],
  level: 3,
  // The level and the directory choose the rules, so two runs compare only when both match.
  variant: ({ directory, level }) => (directory ? `${directory}@${level}` : `@${level}`),
  async run(ctx) {
    const subject = loadSubject(ctx);
    const out: RawFinding[] = [];
    const failed: unknown[] = [];
    const chosen = Object.values(rules).filter((r) => ruleApplies(r, ctx));
    for (const rule of chosen) {
      try {
        out.push(...(await rule.run(subject)));
      } catch (err) {
        failed.push(err);
        ctx.note(`The rule ${rule.id} could not run: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (chosen.length > 0 && failed.length === chosen.length) throw failed[0];
    return out;
  },
};
