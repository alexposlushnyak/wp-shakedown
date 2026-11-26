import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { phpPath, phpVersion, runPhp } from '../php/php.ts';
import { phpTools } from '../php/tools.ts';
import type { Category, Engine, RawFinding, Severity } from '../types.ts';

export interface ThemeCheckMessage {
  check: string;
  html: string;
}

// Resolves to the package root from both src/engines and dist/engines.
const runner = fileURLToPath(new URL('../../php-tools/theme-check.php', import.meta.url));

const ENTITIES: [RegExp, string][] = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#0?39;/g, "'"],
  [/&amp;/g, '&'],
];

const text = (html: string): string => {
  let s = html.replace(/<[^>]*>/g, '');
  for (const [re, to] of ENTITIES) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
};

const SECURITY = ['bad-things', 'worms', 'escaping', 'iframe', 'non-printable', 'included-zip'];
const I18N = ['i18n', 'textdomain'];
const COMPAT = ['deprecated', 'deprecated-param', 'version-php', 'version-tested', 'php-short-tags'];

function categoryOf(rule: string): Category {
  if (SECURITY.includes(rule)) return 'security';
  if (I18N.includes(rule)) return 'i18n';
  if (COMPAT.includes(rule)) return 'compatibility';
  if (rule === 'screen-reader-text') return 'accessibility';
  // Not 'standards': the reports count that category per rule as code style, and a theme requirement must be listed.
  return 'correctness';
}

export function toFindings(messages: ThemeCheckMessage[], isFile: (rel: string) => boolean): RawFinding[] {
  const out: RawFinding[] = [];
  for (const m of messages) {
    const lead = /<span[^>]*tc-lead[^>]*>([\s\S]*?)<\/span>/.exec(m.html);
    const type = lead ? text(lead[1]!).toUpperCase() : '';
    const severity: Severity = type === 'REQUIRED' ? 'error' : type === 'WARNING' ? 'warning' : 'info';
    let rest = (lead ? m.html.slice(lead.index + lead[0].length) : m.html).replace(/^\s*:\s*/, '');

    const lines = new Set<number>();
    for (const pre of rest.matchAll(/<pre[^>]*>[\s\S]*?<\/pre>/g)) {
      for (const l of pre[0].matchAll(/Line (\d+):/g)) lines.add(Number(l[1]));
    }
    rest = rest.replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, '');

    const docs = /href=["'](https?:\/\/[^"']+)["']/.exec(rest)?.[1];
    let file: string | undefined;
    for (const s of rest.matchAll(/<strong>([\s\S]*?)<\/strong>/g)) {
      const candidate = text(s[1]!);
      if (isFile(candidate)) {
        file = candidate;
        break;
      }
    }

    const rule = m.check.replace(/_Check$/, '').toLowerCase().replace(/_/g, '-');
    const base = { rule, severity, category: categoryOf(rule), message: text(rest), ...(docs ? { docs } : {}) };
    const sorted = [...lines].sort((a, b) => a - b);
    if (sorted.length === 0) out.push({ ...base, location: file ? { file } : {} });
    else for (const line of sorted) out.push({ ...base, location: { ...(file ? { file } : {}), line } });
  }
  return out;
}

const lastLine = (s: string): string => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';

export const themeCheck: Engine = {
  id: 'theme-check',
  title: 'Theme Check',
  kinds: ['theme'],
  level: 3,
  variant: ({ themeCheck }) => themeCheck,
  async run({ target, signal, note, themeCheck }) {
    await phpVersion(note);
    const tools = await phpTools(note);
    const r = await runPhp(
      ['-d', 'memory_limit=-1', phpPath(runner), path.join(tools, 'vendor', ...(themeCheck === 'envato' ? ['envato', 'envato-theme-check'] : ['theme-check', 'theme-check'])), phpPath(target.path)],
      { note, ...(signal ? { signal } : {}) },
    );
    if (r.code !== 0) {
      const line = lastLine(r.stderr).replace(/^PHP /, '').replace(/^Fatal error: /, '');
      throw new Error(`Theme Check stopped: ${line || `PHP exited with code ${r.code}.`}`);
    }
    let data: { messages?: unknown; missingParent?: unknown };
    try {
      data = JSON.parse(r.stdout);
    } catch {
      throw new Error('Theme Check returned output that is not JSON.');
    }
    if (!data || !Array.isArray(data.messages)) throw new Error('Theme Check returned output that is not JSON.');
    if (typeof data.missingParent === 'string' && data.missingParent !== '') {
      note(`The parent theme "${data.missingParent}" is not next to this theme. Checks that look for template code may report it missing.`);
    }
    return toFindings(data.messages as ThemeCheckMessage[], (rel) => {
      if (rel === '' || rel.includes('..')) return false;
      try {
        return statSync(path.join(target.path, rel), { throwIfNoEntry: false })?.isFile() === true;
      } catch {
        // The text was a list of names or something else that is not a path.
        return false;
      }
    });
  },
};
