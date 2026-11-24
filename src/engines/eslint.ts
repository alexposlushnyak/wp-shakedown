import { realpathSync } from 'node:fs';
import path from 'node:path';
import { exec } from '../exec.ts';
import { isGenerated, sourceFiles } from '../js/files.ts';
import { jsTools } from '../js/tools.ts';
import type { Category, Engine, RawFinding } from '../types.ts';

export function categoriseJs(ruleId: string): Category {
  if (/^jsx-a11y\//.test(ruleId)) return 'accessibility';
  if (/^@wordpress\/i18n-/.test(ruleId)) return 'i18n';
  if (/^(prettier\/|jsdoc\/|import\/order$|@wordpress\/dependency-group$|no-var$|prefer-|object-shorthand$|camelcase$|curly$|dot-notation$|quote-props$|one-var$|no-else-return$|no-lonely-if$|no-nested-ternary$|no-unneeded-ternary$|no-useless-|spaced-comment$|yoda$|no-console$|no-multi-str$)/.test(ruleId)) return 'standards';
  return 'correctness';
}

interface EslintMessage {
  ruleId: string | null;
  fatal?: boolean;
  message: string;
  line?: number;
  column?: number;
  fix?: unknown;
}

/** The tools print real paths, so a base behind a symlink (macOS /var) is resolved first. */
export function posixRelative(base: string, file: string): string {
  let rel = path.relative(base, file);
  if (rel.startsWith('..')) {
    try {
      rel = path.relative(realpathSync(base), file);
    } catch {
      // Keep the first answer.
    }
  }
  return rel.split(path.sep).join('/');
}

export function parseEslint(json: string, base: string): RawFinding[] {
  let data: { filePath: string; messages?: EslintMessage[] }[];
  try {
    data = JSON.parse(json);
  } catch {
    data = null as never;
  }
  if (!Array.isArray(data)) throw new Error('ESLint returned output that is not JSON.');
  const out: RawFinding[] = [];
  for (const f of data) {
    for (const m of f.messages ?? []) {
      const location = {
        file: posixRelative(base, f.filePath),
        ...(m.line ? { line: m.line } : {}),
        ...(m.column ? { column: m.column } : {}),
      };
      if (m.fatal) {
        out.push({ rule: 'syntax', severity: 'error', category: 'correctness', message: m.message, location });
        continue;
      }
      const rule = m.ruleId ?? 'eslint';
      const category = categoriseJs(rule);
      out.push({
        rule,
        severity: category === 'standards' ? 'info' : 'warning',
        category,
        message: m.message,
        location,
        ...(m.fix ? { hint: 'eslint --fix can fix this.' } : {}),
      });
    }
  }
  return out;
}

export const firstLine = (s: string): string => s.split('\n').map((l) => l.trim()).find(Boolean) ?? '';

export function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const eslint: Engine = {
  id: 'eslint',
  title: 'JavaScript',
  kinds: ['theme', 'plugin'],
  async run({ target, signal, note }) {
    const files = sourceFiles(target.path, ['.js', '.jsx', '.mjs', '.cjs']).filter((f) => !isGenerated(f));
    if (files.length === 0) return [];
    const tools = await jsTools(note);
    const out: RawFinding[] = [];
    for (const chunk of chunks(files, 200)) {
      if (signal?.aborted) break;
      const r = await exec(
        process.execPath,
        [
          path.join(tools, 'node_modules', 'eslint', 'bin', 'eslint.js'),
          '--no-config-lookup', '-c', path.join(tools, 'eslint.config.mjs'),
          '--format', 'json', '--no-error-on-unmatched-pattern', '--no-warn-ignored',
          ...chunk.map((f) => posixRelative(target.path, f)),
        ],
        { cwd: target.path, ...(signal ? { signal } : {}) },
      );
      if (r.code !== 0 && r.code !== 1) throw new Error(`ESLint stopped: ${firstLine(r.stderr) || firstLine(r.stdout)}`);
      out.push(...parseEslint(r.stdout, target.path));
    }
    return out;
  },
};
