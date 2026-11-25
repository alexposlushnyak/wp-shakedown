import { existsSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { phpPath } from '../php/php.ts';
import { runPhpcs } from '../php/phpcs.ts';
import type { PhpcsMessage } from '../php/phpcs.ts';
import { textDomain } from '../target.ts';
import type { Category, Engine, RawFinding, Severity } from '../types.ts';

const RULES: [RegExp, Category][] = [
  [/^PluginCheck\.Security\./, 'security'],
  [/^PluginCheck\.CodeAnalysis\./, 'correctness'],
  [/^WordPress\.PHP\.YodaConditions/, 'standards'],
  [/^WordPress\.Security\./, 'security'],
  [/^WordPress\.DB\.PreparedSQL/, 'security'],
  [/^WordPress\.WP\.I18n\./, 'i18n'],
  [/^WordPress\.DB\.(DirectDatabaseQuery|SlowDBQuery)/, 'performance'],
  [/^WordPress\.(WP|PHP|DB|DateTime|CodeAnalysis|Utils)\./, 'correctness'],
  [/^(Generic\.PHP\.(Syntax|BacktickOperator|DiscourageGoto|ForbiddenFunctions)|Squiz\.PHP\.(Eval|DiscouragedFunctions)|Generic\.CodeAnalysis\.|Generic\.PHP\.(DisallowShortOpenTag|DisallowAlternativePHPTags)|Generic\.Files\.ByteOrderMark)/, 'correctness'],
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

const PLUGIN_RULESET = `<?xml version="1.0"?>
<ruleset name="wp-shakedown plugin">
	<rule ref="WordPress-Extra"/>
	<rule ref="./vendor/plugin-check/phpcs-sniffs/phpcs-rulesets/plugin-review.xml"/>
</ruleset>
`;

/** The WordPress-Extra rules plus the Plugin Check review rules, as a ruleset file in the tools folder. */
export function pluginRuleset(tools: string): string {
  const file = path.join(tools, 'wp-shakedown-plugin.xml');
  if (!existsSync(file)) writeFileSync(file, PLUGIN_RULESET);
  return file;
}

const RULESETS = ['.phpcs.xml', 'phpcs.xml', '.phpcs.xml.dist', 'phpcs.xml.dist'];

export const wpcs: Engine = {
  id: 'wpcs',
  title: 'WordPress Coding Standards',
  kinds: ['theme', 'plugin'],
  async run({ target, signal, note }) {
    let standard: string | ((tools: string) => string) = target.kind === 'plugin' ? pluginRuleset : 'WordPress-Extra';
    let own = false;
    if (statSync(target.path).isDirectory()) {
      const name = RULESETS.find((n) => existsSync(path.join(target.path, n)));
      if (name) {
        standard = path.join(phpPath(target.path), name);
        own = true;
        note(`Using the project ruleset ${name}.`);
      }
    }
    // A text domain from the command line would override the one a project ruleset sets.
    const domain = own ? undefined : textDomain(target);
    const extra = domain ? ['--runtime-set', 'text_domain', domain] : [];
    return (await runPhpcs({ target, standard, extra, ...(signal ? { signal } : {}), note })).map(toFinding);
  },
};
