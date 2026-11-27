import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv } from 'ajv';
import { MAX_LEVEL, parseFailOn } from './types.ts';
import type { Severity, Target } from './types.ts';

export const CONFIG_FILE = 'wp-shakedown.json';

/** What a project says about how to test it. Choices only: no checks, no commands, no AI provider. */
export interface ProjectConfig {
  preset?: string;
  engines?: string[];
  level?: number;
  failOn?: Severity | 'never';
}

const validate = new Ajv({ strict: false }).compile({
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    preset: { type: 'string', minLength: 1 },
    engines: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
    level: { type: 'integer', minimum: 0, maximum: MAX_LEVEL },
    failOn: { enum: ['critical', 'important', 'recommended', 'never', 'error', 'warning', 'info'] },
  },
  additionalProperties: false,
});

const fail = (reason: string): never => {
  throw new Error(`${CONFIG_FILE} is not valid: ${reason}.`);
};

/** The settings in wp-shakedown.json at the root of a theme, a plugin or an install. Throws when the file is not valid. */
export function readProjectConfig(target: Target): { config: ProjectConfig; file: string } | undefined {
  if (target.kind === 'url') return undefined;
  const file = path.join(target.path, CONFIG_FILE);
  if (!existsSync(file)) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fail('it is not JSON');
  }
  if (!validate(data)) {
    const e = validate.errors![0]!;
    const name = e.keyword === 'additionalProperties' ? (e.params as { additionalProperty: string }).additionalProperty : undefined;
    if (name === 'assistant') fail('it cannot turn on an assistant. Set the assistant in a preset of your own, see wp-shakedown presets');
    if (name === 'checks' || name === 'command') fail('it cannot hold checks or commands. Put your own checks in ~/.wp-shakedown/checks');
    fail(name ? `it has a field the format does not know, "${name}"` : `${e.instancePath || 'the file'} ${e.message}`);
  }
  const d = data as { preset?: string; engines?: string[]; level?: number; failOn?: string };
  if (d.preset !== undefined && d.engines !== undefined) fail('it sets both preset and engines. Use one of them');
  const config: ProjectConfig = {
    ...(d.preset !== undefined ? { preset: d.preset } : {}),
    ...(d.engines !== undefined ? { engines: d.engines } : {}),
    ...(d.level !== undefined ? { level: d.level } : {}),
    ...(d.failOn !== undefined ? { failOn: parseFailOn(d.failOn) } : {}),
  };
  return { config, file };
}
