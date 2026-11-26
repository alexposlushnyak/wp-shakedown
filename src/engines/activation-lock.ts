import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { phpFiles } from '../php/files.ts';
import type { Engine, RawFinding } from '../types.ts';

const DOCS = 'https://github.com/alexposlushnyak/wp-shakedown/blob/main/docs/reference/engines.md#activation-lock';
const MAX_FILE = 2 * 1024 * 1024;

// A bare "license" or "activated" is too common: license.txt files, the ?activated=true redirect after a theme switch.
const LICENSE = /purchase[_-]?code|licen[sc]e[_-]?(?:is[_-]?)?(?:key|code|status|valid|active|activated|check|data|state)|(?:is|has|check|verify|validate)_?licen[sc]e|is_activated|is_registered|activation_status|envato_api|envato_token|verify_purchase/i;
const GATE = /\b(?:return|exit|die|require|require_once|include|include_once)\b|\b(?:wp_die|remove_action|remove_filter|deactivate_plugins|switch_theme|register_block_type|register_post_type|register_taxonomy|add_theme_support|add_shortcode)\s*\(/;
const HOOK = /\badd_(?:action|filter)\s*\(\s*(?:(['"])([^'"]*)\1)?/g;
const NOTICES = new Set(['admin_notices', 'network_admin_notices', 'all_admin_notices']);

/** Index after the quoted string that starts at `i`. */
function endOfString(s: string, i: number): number {
  const q = s[i]!;
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') j++;
    else if (s[j] === q) return j + 1;
  }
  return s.length;
}

/** Replaces PHP comments with spaces and keeps newlines and strings, so line numbers stay right. */
export function stripComments(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const c = s[i]!;
    const two = s.slice(i, i + 2);
    if (c === '"' || c === "'") {
      const end = endOfString(s, i);
      out += s.slice(i, end);
      i = end;
    } else if (two === '/*' || two === '//' || (c === '#' && s[i + 1] !== '[')) {
      let end: number;
      if (two === '/*') end = s.indexOf('*/', i + 2) < 0 ? s.length : s.indexOf('*/', i + 2) + 2;
      else {
        // A line comment ends at a newline or at a closing PHP tag.
        const m = /\r?\n|\?>/.exec(s.slice(i));
        end = m ? i + m.index : s.length;
      }
      out += s.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Index of the bracket that closes the one at `i`, or -1. Strings do not count. */
function close(s: string, i: number): number {
  const open = s[i]!;
  const end = open === '(' ? ')' : '}';
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j]!;
    if (c === '"' || c === "'") j = endOfString(s, j) - 1;
    else if (c === open) depth++;
    else if (c === end && --depth === 0) return j;
  }
  return -1;
}

/** The text a conditional runs: a brace block, an alternative-syntax block or the next statement. */
function body(s: string, from: number): string {
  const m = /^\s*/.exec(s.slice(from))!;
  const i = from + m[0].length;
  if (s[i] === '{') {
    const end = close(s, i);
    return s.slice(i + 1, end < 0 ? s.length : end);
  }
  if (s[i] === ':') {
    const m2 = /\b(?:elseif|else|endif)\b/.exec(s.slice(i));
    return s.slice(i + 1, m2 ? i + m2.index : s.length);
  }
  let j = i;
  while (j < s.length && s[j] !== ';') {
    if (s[j] === '"' || s[j] === "'") j = endOfString(s, j);
    else j++;
  }
  return s.slice(i, j);
}

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

/** Findings of one PHP source. */
export function scan(source: string, file: string): RawFinding[] {
  const s = stripComments(source);
  const out: RawFinding[] = [];
  for (const m of s.matchAll(/\b(?:else\s*)?if\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const end = close(s, open);
    if (end < 0) continue;
    const cond = s.slice(open, end + 1);
    if (!LICENSE.test(cond) && !(/item_id/i.test(cond) && /envato/i.test(cond))) continue;
    if (!gated(body(s, end + 1))) continue;
    out.push({
      rule: 'features-locked',
      severity: 'warning',
      category: 'correctness',
      message: 'Features run only after activation with a purchase code or license key.',
      location: { file, line: s.slice(0, m.index).split('\n').length },
      hint: 'Show a notice about the missing activation and keep every feature working without it.',
      docs: DOCS,
    });
  }
  return out;
}

export const activationLock: Engine = {
  id: 'activation-lock',
  title: 'Features locked behind activation',
  kinds: ['theme', 'plugin'],
  level: 7,
  async run({ target }) {
    const root = statSync(target.path).isFile() ? path.dirname(target.path) : target.path;
    const out: RawFinding[] = [];
    for (const full of phpFiles(target.path)) {
      if (statSync(full).size > MAX_FILE) continue;
      const text = readFileSync(full, 'utf8');
      const file = path.relative(root, full).split(path.sep).join('/');
      if (!isGenerated(file, text)) out.push(...scan(text, file));
    }
    return out;
  },
};
