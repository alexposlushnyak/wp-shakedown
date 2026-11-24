import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { runPhpcs } from '../php/phpcs.ts';
import type { PhpcsMessage } from '../php/phpcs.ts';
import type { Category, Engine, RawFinding, Severity } from '../types.ts';

const RULES: [RegExp, Category][] = [
  [/^WordPress\.PHP\.YodaConditions/, 'standards'],
  [/^WordPress\.Security\./, 'security'],
  [/^WordPress\.DB\.PreparedSQL/, 'security'],
  [/^WordPress\.WP\.I18n\./, 'i18n'],
  [/^WordPress\.DB\.(DirectDatabaseQuery|SlowDBQuery)/, 'performance'],
  [/^WordPress\.(WP|PHP|DB|DateTime|CodeAnalysis|Utils)\./, 'correctness'],
  [/^(Generic\.PHP\.(Syntax|BacktickOperator|DiscourageGoto|ForbiddenFunctions)|Squiz\.PHP\.(Eval|DiscouragedFunctions)|Generic\.CodeAnalysis\.)/, 'correctness'],
];

export function categorise(source: string): Category {
  return RULES.find(([re]) => re.test(source))?.[1] ?? 'standards';
}

export function toFinding(m: PhpcsMessage): RawFinding {
  const category = categorise(m.source);
  const error = m.type === 'ERROR';
  const severity: Severity = category === 'standards' ? (error ? 'warning' : 'info') : error ? 'error' : 'warning';
  return {
    rule: m.source,
    severity,
    category,
    message: m.message,
    location: { file: m.file, line: m.line, column: m.column },
    ...(m.fixable ? { hint: 'phpcbf can fix this.' } : {}),
  };
}

const RULESETS = ['.phpcs.xml', 'phpcs.xml', '.phpcs.xml.dist', 'phpcs.xml.dist'];

export const wpcs: Engine = {
  id: 'wpcs',
  title: 'WordPress Coding Standards',
  kinds: ['theme', 'plugin'],
  async run({ target, signal, note }) {
    let standard = 'WordPress-Extra';
    if (statSync(target.path).isDirectory()) {
      const name = RULESETS.find((n) => existsSync(path.join(target.path, n)));
      if (name) {
        standard = path.join(target.path, name);
        note(`Using the project ruleset ${name}.`);
      }
    }
    return (await runPhpcs({ target, standard, ...(signal ? { signal } : {}), note })).map(toFinding);
  },
};
