import assert from 'node:assert/strict';
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { Ajv } from 'ajv';
import { root } from './env.ts';
import { assistantTasks } from '../src/assistant/select.ts';
import { engines } from '../src/engines/index.ts';
import { exec } from '../src/exec.ts';
import { run } from '../src/runner.ts';
import { detectTarget } from '../src/target.ts';
import type { Directory } from '../src/types.ts';
import { fakeNet, tmp } from './helpers.ts';

interface Case {
  id: string;
  sources: string[];
  status: 'caught' | 'assistant' | 'open';
  expect?: { engine: string; rule: string; level?: number; directory?: Directory };
  assistant?: string;
  run?: { level?: number; directory?: Directory };
  checked: string;
}

const CATEGORIES = ['security', 'accessibility', 'i18n', 'licensing', 'readme', 'assets', 'review-process', 'plugin-territory', 'settings', 'compatibility', 'other'];
const level = { type: 'integer', minimum: 0, maximum: 10 };
const directory = { enum: ['wporg', 'envato'] };
const common = {
  id: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
  title: { type: 'string', minLength: 1 },
  summary: { type: 'string', minLength: 1 },
  sources: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: '^https://themes\\.trac\\.wordpress\\.org/ticket/[0-9]+$' } },
  category: { enum: CATEGORIES },
  kinds: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['theme', 'plugin'] } },
  tags: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
  checked: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
};
const shape = (status: string, props: object, required: string[]): object => ({
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'summary', 'sources', 'category', 'kinds', 'tags', 'status', 'checked', ...required],
  properties: { ...common, status: { const: status }, ...props },
});
const schema = {
  oneOf: [
    shape('caught', { expect: { type: 'object', additionalProperties: false, required: ['engine', 'rule'], properties: { engine: { type: 'string' }, rule: { type: 'string' }, level, directory } } }, ['expect']),
    shape('assistant', { assistant: { type: 'string' }, run: { type: 'object', additionalProperties: false, properties: { level, directory } } }, ['assistant']),
    shape('open', { note: { type: 'string', minLength: 1 } }, ['note']),
  ],
};
const validate = new Ajv({ allErrors: true }).compile(schema);

const casesDir = path.join(root, 'cases');
const folders = readdirSync(casesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const cases = new Map<string, Case>();
const invalid: string[] = [];
for (const name of folders) {
  const data: unknown = JSON.parse(readFileSync(path.join(casesDir, name, 'case.json'), 'utf8'));
  if (validate(data)) cases.set(name, data as Case);
  else invalid.push(`${name}: ${new Ajv().errorsText(validate.errors)}`);
}

const phpAvailable = await Promise.all([exec('php', ['-v']), exec('composer', ['--version'])]).then(
  (r) => r.every((x) => x.code === 0),
  () => false,
);
const PHP_ENGINES = new Set(['wpcs', 'theme-check']);
const today = new Date().toISOString().slice(0, 10);

test('every case.json is valid', () => {
  assert.deepEqual(invalid, []);
  assert.ok(cases.size > 0);
});

test('ids are unique, equal the folder name and no case repeats a ticket with the same rule', () => {
  const seen = new Map<string, string>();
  for (const [name, c] of cases) {
    assert.equal(c.id, name, `${name}: the id must equal the folder name`);
    assert.ok(c.checked <= today, `${name}: checked is in the future`);
    const what = c.expect ? `${c.expect.engine}/${c.expect.rule}` : c.assistant ? `assistant/${c.assistant}` : undefined;
    if (!what) continue;
    for (const url of c.sources) {
      const key: string = `${url} ${what}`;
      assert.equal(seen.get(key), undefined, `${name} repeats ${seen.get(key)}: ${url} with ${what}`);
      seen.set(key, name);
    }
  }
});

test('fixtures exist for caught and assistant cases and not for open ones', () => {
  for (const [name, c] of cases) {
    assert.equal(existsSync(path.join(casesDir, name, 'fixture')), c.status !== 'open', `${name}: fixture`);
  }
});

describe('cases', () => {
  for (const [name, c] of cases) {
    const fixture = path.join(casesDir, name, 'fixture');
    if (c.status === 'caught') {
      const { engine, rule } = c.expect!;
      const opts = PHP_ENGINES.has(engine) && !phpAvailable ? { skip: 'PHP and Composer are needed', timeout: 600000 } : { timeout: 600000 };
      test(name, opts, async (t) => {
        // The PHP engines keep their tools in the test home, which fakeNet replaces.
        if (!PHP_ENGINES.has(engine)) fakeNet(t, new Map([['https://api.wordpress.org/core/version-check/1.7/', { status: 200, body: { offers: [{ version: '7.0' }] } }]]));
        // Theme Check finds the screenshot only in a folder like themes/<name>.
        const copy = path.join(tmp(t), 'themes', name);
        cpSync(fixture, copy, { recursive: true });
        const r = await run(detectTarget(copy), {
          engines,
          only: [engine],
          level: c.expect!.level ?? 6,
          ...(c.expect!.directory ? { directory: c.expect!.directory } : {}),
        });
        assert.equal(r.engines[0]?.status, 'ok', JSON.stringify(r.engines));
        assert.ok(
          r.findings.some((f) => f.engine === engine && f.rule === rule),
          `${engine} did not report ${rule}. It reported: ${[...new Set(r.findings.map((f) => f.rule))].join(', ') || 'nothing'}`,
        );
      });
    } else if (c.status === 'assistant') {
      test(name, () => {
        const tasks = assistantTasks(detectTarget(fixture), { level: c.run?.level ?? 6, ...(c.run?.directory ? { directory: c.run.directory } : {}) });
        assert.ok(tasks.some((x) => x.id === c.assistant), `${c.assistant} is not listed. Listed: ${tasks.map((x) => x.id).join(', ') || 'nothing'}`);
      });
    }
  }
});
