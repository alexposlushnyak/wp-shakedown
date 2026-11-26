import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv } from 'ajv';
import { home } from './home.ts';
import { MAX_LEVEL } from './types.ts';
import type { Preset, Target, TargetKind } from './types.ts';

export const builtInPresets: Preset[] = [
  {
    id: 'wporg-theme',
    title: 'WordPress.org theme directory',
    summary: 'What the theme directory of wordpress.org checks before a review: Theme Check, PHP that parses, the WordPress standards and theme.json, the points reviewers raise most, and features locked behind activation.',
    kinds: ['theme'],
    engines: ['php-lint', 'theme-check', 'theme-review', 'wpcs', 'php-compat', 'wp-json', 'activation-lock'],
    level: 7,
    builtIn: true,
  },
  {
    id: 'envato',
    title: 'ThemeForest',
    summary: 'What Envato checks on a theme for ThemeForest: its own version of Theme Check, PHP that parses, the WordPress standards and theme.json.',
    kinds: ['theme'],
    engines: ['php-lint', 'theme-check', 'wpcs', 'php-compat', 'wp-json', 'activation-lock'],
    level: 7,
    themeCheck: 'envato',
    builtIn: true,
  },
  {
    id: 'wporg-plugin',
    title: 'WordPress.org plugin directory',
    summary: 'What the plugin directory of wordpress.org checks in code: PHP that parses, the Plugin Check review rules and PHP versions.',
    kinds: ['plugin'],
    engines: ['php-lint', 'wpcs', 'php-compat', 'activation-lock'],
    level: 7,
    builtIn: true,
  },
  {
    id: 'client',
    title: 'Client or commercial project',
    summary: 'A theme or plugin made for a client or sold outside the directories: the WordPress standards, PHP versions, static analysis and the JS and CSS linters, without the rules of the directories.',
    kinds: ['theme', 'plugin'],
    engines: ['php-lint', 'wp-json', 'wpcs', 'php-compat', 'phpstan', 'eslint', 'stylelint'],
    level: 8,
    builtIn: true,
  },
  {
    id: 'site',
    title: 'WordPress site',
    summary: 'Whether a WordPress folder is intact, current and safe to run. Leaves out code style in themes and plugins.',
    kinds: ['install'],
    engines: ['integrity', 'updates', 'vulnerabilities', 'config', 'site-health', 'php-lint', 'php-compat'],
    level: 6,
    builtIn: true,
  },
];

export const PRESET_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

const KIND: Record<TargetKind, string> = { theme: 'a theme', plugin: 'a plugin', install: 'a WordPress folder', url: 'a site URL' };
const dir = (): string => path.join(home(), 'presets');
const fileOf = (id: string): string => path.join(dir(), `${id}.json`);

const validate = new Ajv({ strict: false }).compile({
  type: 'object',
  properties: {
    schema: { const: 1 },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: 'string', minLength: 1, maxLength: 500 },
    kinds: { type: 'array', items: { enum: ['theme', 'plugin', 'install'] }, minItems: 1, uniqueItems: true },
    engines: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9][a-z0-9:-]*$' }, minItems: 1 },
    level: { type: 'integer', minimum: 0, maximum: MAX_LEVEL },
    failOn: { enum: ['error', 'warning', 'info', 'never'] },
    themeCheck: { const: 'envato' },
  },
  required: ['schema', 'title', 'summary', 'kinds', 'engines'],
  additionalProperties: false,
});

/** The file content as a preset, or the reason it is not one. */
function check(id: string, data: unknown): Preset {
  if (!PRESET_ID.test(id)) throw new Error('The ID must be lowercase letters, digits and hyphens, up to 41 characters, and start with a letter or digit.');
  if (builtInPresets.some((p) => p.id === id)) throw new Error(`"${id}" is the ID of a built-in preset.`);
  if (!validate(data)) {
    const e = validate.errors![0]!;
    const unknown = e.keyword === 'additionalProperties' ? (e.params as { additionalProperty?: string }).additionalProperty : undefined;
    throw new Error(unknown ? `it has a field the format does not know, "${unknown}"` : `${e.instancePath || 'the file'} ${e.message}`);
  }
  const d = data as { title: string; summary: string; kinds: TargetKind[]; engines: string[]; level?: number; failOn?: Preset['failOn']; themeCheck?: 'envato' };
  return {
    id,
    title: d.title,
    summary: d.summary,
    kinds: d.kinds,
    engines: d.engines,
    ...(d.level !== undefined ? { level: d.level } : {}),
    ...(d.failOn !== undefined ? { failOn: d.failOn } : {}),
    ...(d.themeCheck !== undefined ? { themeCheck: d.themeCheck } : {}),
  };
}

function readUser(id: string): Preset {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(fileOf(id), 'utf8'));
  } catch {
    throw new Error('it is not JSON');
  }
  return check(id, data);
}

/** The built-in presets, then the presets in <home>/presets sorted by ID. A file that is not a preset is listed in `problems` and never throws. */
export function listPresets(): { presets: Preset[]; problems: { file: string; error: string }[] } {
  const presets = [...builtInPresets];
  const problems: { file: string; error: string }[] = [];
  const names = existsSync(dir()) ? readdirSync(dir()).filter((n) => n.endsWith('.json')).sort() : [];
  for (const name of names) {
    try {
      presets.push(readUser(name.slice(0, -'.json'.length)));
    } catch (err) {
      problems.push({ file: path.join(dir(), name), error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { presets, problems };
}

export const findPreset = (id: string): Preset | undefined => listPresets().presets.find((p) => p.id === id);

/** The engine IDs a preset runs on this target, out of the IDs in `known`. Throws when the preset is unknown or does not fit the target. IDs of engines that do not exist are dropped, so a preset keeps working when an engine is missing. */
export function presetEngines(id: string, target: Target, known: readonly string[]): string[] {
  let preset = builtInPresets.find((p) => p.id === id);
  if (!preset) {
    if (!existsSync(fileOf(id)) || !PRESET_ID.test(id)) {
      throw new Error(`Unknown preset "${id}". Known presets: ${listPresets().presets.map((p) => p.id).join(', ')}.`);
    }
    try {
      preset = readUser(id);
    } catch (err) {
      throw new Error(`The preset file ${fileOf(id)} is not valid: ${err instanceof Error ? err.message : String(err)}.`);
    }
  }
  if (!preset.kinds.includes(target.kind)) {
    throw new Error(`The ${id} preset checks ${preset.kinds.map((k) => KIND[k]).join(' or ')}. "${target.name}" is ${KIND[target.kind]}.`);
  }
  return preset.engines.filter((e) => known.includes(e));
}

/** Writes a user preset, replacing one with the same ID. Throws when the preset is not valid or has a built-in ID. */
export function savePreset(preset: Preset): void {
  let data: unknown;
  try {
    const { id, builtIn: _builtIn, ...rest } = preset;
    // The round trip drops fields set to undefined, as the file would.
    data = JSON.parse(JSON.stringify({ schema: 1, ...rest }));
    check(id, data);
  } catch (err) {
    throw new Error(`The preset is not valid: ${err instanceof Error ? err.message : String(err)}`);
  }
  mkdirSync(dir(), { recursive: true });
  // Write next to the file and rename, so a reader never sees half a file.
  const tmp = `${fileOf(preset.id)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, fileOf(preset.id));
}

/** Deletes a user preset. Returns false when there is none. Throws for a built-in preset. */
export function removePreset(id: string): boolean {
  if (builtInPresets.some((p) => p.id === id)) throw new Error(`"${id}" is a built-in preset and cannot be removed.`);
  if (!PRESET_ID.test(id) || !existsSync(fileOf(id))) return false;
  rmSync(fileOf(id));
  return true;
}

/** The text table for the `presets` command: one row per preset, columns padded with spaces. */
export function presetTable(presets: Preset[]): string {
  const rows = presets.map((p) => [p.id, p.title, p.kinds.join(', '), p.level === undefined ? '-' : String(p.level), String(p.engines.length), p.builtIn ? 'built-in' : fileOf(p.id)]);
  const all = [['ID', 'Title', 'Kinds', 'Level', 'Engines', 'Source'], ...rows];
  const widths = all[0]!.map((_, c) => Math.max(...all.map((r) => r[c]!.length)));
  return all.map((r) => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]!))).join('  ').trimEnd()).join('\n');
}
