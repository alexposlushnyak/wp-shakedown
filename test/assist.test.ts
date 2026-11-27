import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { runAssist } from '../src/assistant/assist.ts';
import { detectTarget } from '../src/target.ts';
import type { AssistantAnswer } from '../src/types.ts';
import { setupRun } from './assistant-helpers.ts';
import './env.ts';
import { makeTheme, tmp } from './helpers.ts';

function home(t: TestContext): void {
  const old = process.env.WP_SHAKEDOWN_HOME;
  process.env.WP_SHAKEDOWN_HOME = tmp(t);
  t.after(() => {
    if (old === undefined) delete process.env.WP_SHAKEDOWN_HOME;
    else process.env.WP_SHAKEDOWN_HOME = old;
  });
}

const fake = async (_p: string, task: { id: string }): Promise<AssistantAnswer> =>
  task.id === 'one'
    ? { check: 'one', verdict: 'fail', findings: [{ file: 'a.php', line: 3, severity: 'error', message: 'Bad.', fix: 'Fix it.' }] }
    : { check: 'two', verdict: 'unsure', findings: [], error: 'It broke.' };

test('it refuses without a report and without a preset that names an assistant', async (t) => {
  home(t);
  const theme = makeTheme(tmp(t));
  const target = detectTarget(theme);
  await assert.rejects(runAssist({ dir: tmp(t), target }), /No report yet\. Run the checks first\./);
  const dir = setupRun(theme, undefined);
  await assert.rejects(runAssist({ dir, target, ask: fake }), /allows an assistant/);
});

test('it writes assistant.json, assistant.md and the copy in runs/', async (t) => {
  home(t);
  const theme = makeTheme(tmp(t), 'Alpha');
  const dir = setupRun(theme, 'claude');
  const seen: string[] = [];
  const { report, files } = await runAssist({ dir, target: detectTarget(theme), ask: fake, onAnswer: (a, done, total) => seen.push(`${a.check} ${done}/${total}`) });
  assert.deepEqual(seen, ['one 1/2', 'two 2/2']);
  assert.equal(report.provider, 'claude');
  assert.equal(report.run, '2026-01-01T00:00:01.000Z');
  assert.deepEqual(files, [path.join(dir, 'assistant.md'), path.join(dir, 'assistant.json')]);
  const md = readFileSync(files[0]!, 'utf8');
  assert.match(md, /^# Assistant checks: Alpha\n\nClaude Code, .* UTC\. 0 pass, 1 fail, 1 unsure\./);
  assert.match(md, /## First check \(fail\)/);
  assert.match(md, /- Critical a\.php:3: Bad\.\n {2}Fix: Fix it\./);
  assert.match(md, /## Second check \(unsure\)\n\nIt broke\./);
  assert.deepEqual(JSON.parse(readFileSync(files[1]!, 'utf8')), report);
  const run = readdirSync(path.join(dir, 'runs'))[0]!;
  assert.ok(existsSync(path.join(dir, 'runs', run, 'assistant.json')));
});

test('--check filters the checks and rejects an unknown id', async (t) => {
  home(t);
  const theme = makeTheme(tmp(t));
  const dir = setupRun(theme, 'codex');
  const { report } = await runAssist({ dir, target: detectTarget(theme), checks: ['two'], ask: fake });
  assert.deepEqual(report.answers.map((a) => a.check), ['two']);
  await assert.rejects(runAssist({ dir, target: detectTarget(theme), checks: ['nope'], ask: fake }), /No check "nope" in the last run\./);
});
