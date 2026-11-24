import path from 'node:path';
import { exec } from '../exec.ts';
import { isGenerated, sourceFiles } from '../js/files.ts';
import { jsTools } from '../js/tools.ts';
import type { Category, Engine, RawFinding } from '../types.ts';
import { chunks, firstLine, posixRelative } from './eslint.ts';

export function categoriseCss(rule: string): Category {
  return /(-no-unknown$|-no-invalid|^no-invalid-|no-duplicate-|^block-no-empty$|-no-shorthand-property-overrides$|^string-no-newline$|^no-empty-source$|-no-missing-generic-family-keyword$|^no-irregular-whitespace$)/.test(rule)
    ? 'correctness'
    : 'standards';
}

export function parseStylelint(json: string, base: string): RawFinding[] {
  let data: { source: string; warnings?: { line: number; column: number; rule: string; text: string }[] }[];
  try {
    data = JSON.parse(json);
  } catch {
    data = null as never;
  }
  if (!Array.isArray(data)) throw new Error('Stylelint returned output that is not JSON.');
  const out: RawFinding[] = [];
  for (const f of data) {
    for (const w of f.warnings ?? []) {
      const message = w.text.endsWith(` (${w.rule})`) ? w.text.slice(0, -` (${w.rule})`.length) : w.text;
      const location = { file: posixRelative(base, f.source), line: w.line, column: w.column };
      if (w.rule === 'CssSyntaxError') {
        out.push({ rule: 'syntax', severity: 'error', category: 'correctness', message, location });
        continue;
      }
      const category = categoriseCss(w.rule);
      out.push({ rule: w.rule, severity: category === 'standards' ? 'info' : 'warning', category, message, location });
    }
  }
  return out;
}

export const stylelint: Engine = {
  id: 'stylelint',
  title: 'CSS',
  kinds: ['theme', 'plugin'],
  async run({ target, signal, note }) {
    const files = sourceFiles(target.path, ['.css', '.scss']).filter((f) => !isGenerated(f));
    if (files.length === 0) return [];
    const tools = await jsTools(note);
    const out: RawFinding[] = [];
    for (const chunk of chunks(files, 200)) {
      if (signal?.aborted) break;
      const r = await exec(
        process.execPath,
        [
          path.join(tools, 'node_modules', 'stylelint', 'bin', 'stylelint.mjs'),
          '--config', path.join(tools, 'stylelint.config.mjs'), '--config-basedir', tools,
          '--formatter', 'json', '--allow-empty-input',
          ...chunk.map((f) => posixRelative(target.path, f)),
        ],
        { cwd: target.path, ...(signal ? { signal } : {}) },
      );
      // Stylelint prints its JSON to stderr when it finds problems.
      const text = r.stdout.trim() || r.stderr.trim();
      if (!text.startsWith('[')) throw new Error(`Stylelint stopped: ${firstLine(r.stderr) || firstLine(r.stdout)}`);
      out.push(...parseStylelint(text, target.path));
    }
    return out;
  },
};
