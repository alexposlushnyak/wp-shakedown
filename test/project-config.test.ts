import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import './env.ts';
import { readProjectConfig } from '../src/config.ts';
import { runMany, hubExitCode } from '../src/hub.ts';
import { runSession } from '../src/session.ts';
import { toHtml } from '../src/report/html.ts';
import { toMarkdown } from '../src/report/markdown.ts';
import { toShort } from '../src/report/short.ts';
import { detectTarget } from '../src/target.ts';
import { fakeEngine, makeTheme, raw, result, tmp, write } from './helpers.ts';

const FILE = 'wp-shakedown.json';

function theme(t: TestContext, config?: unknown): string {
  const dir = makeTheme(tmp(t));
  if (config !== undefined) write(path.join(dir, FILE), typeof config === 'string' ? config : JSON.stringify(config));
  return dir;
}
const read = (dir: string) => readProjectConfig(detectTarget(dir));
const reason = (t: TestContext, config: unknown): string => {
  const dir = theme(t, config);
  try {
    read(dir);
  } catch (err) {
    return (err as Error).message;
  }
  return '';
};

function home(t: TestContext): string {
  const dir = tmp(t);
  const old = process.env.WP_SHAKEDOWN_HOME;
  process.env.WP_SHAKEDOWN_HOME = dir;
  t.after(() => {
    if (old === undefined) delete process.env.WP_SHAKEDOWN_HOME;
    else process.env.WP_SHAKEDOWN_HOME = old;
  });
  return dir;
}

test('readProjectConfig: preset, level and failOn', (t) => {
  const dir = theme(t, { $schema: 'x', preset: 'client', level: 4, failOn: 'important' });
  assert.deepEqual(read(dir), { config: { preset: 'client', level: 4, failOn: 'warning' }, file: path.join(dir, FILE) });
});

test('readProjectConfig: engines, level bounds, failOn names', (t) => {
  assert.deepEqual(read(theme(t, { engines: ['php-lint'], level: 0 }))!.config, { engines: ['php-lint'], level: 0 });
  assert.equal(read(theme(t, { level: 10, failOn: 'never' }))!.config.level, 10);
  assert.equal(read(theme(t, { failOn: 'info' }))!.config.failOn, 'info');
  assert.match(reason(t, { level: 11 }), /^wp-shakedown\.json is not valid: .*level.*\.$/);
  assert.match(reason(t, { level: -1 }), /is not valid/);
  assert.match(reason(t, { level: 1.5 }), /is not valid/);
  assert.match(reason(t, { engines: [] }), /is not valid/);
  assert.match(reason(t, { failOn: 'loud' }), /is not valid/);
});

test('readProjectConfig: errors', (t) => {
  assert.match(reason(t, { preset: 'client', engines: ['php-lint'] }), /^wp-shakedown\.json is not valid: it sets both preset and engines/);
  assert.equal(reason(t, { colour: 1 }), 'wp-shakedown.json is not valid: it has a field the format does not know, "colour".');
  assert.equal(reason(t, { assistant: 'claude' }), 'wp-shakedown.json is not valid: it cannot turn on an assistant. Set the assistant in a preset of your own, see wp-shakedown presets.');
  const checks = 'wp-shakedown.json is not valid: it cannot hold checks or commands. Put your own checks in ~/.wp-shakedown/checks.';
  assert.equal(reason(t, { checks: [] }), checks);
  assert.equal(reason(t, { command: 'ls' }), checks);
  assert.equal(reason(t, '{'), 'wp-shakedown.json is not valid: it is not JSON.');
});

test('readProjectConfig: no file and url targets give undefined', (t) => {
  assert.equal(read(theme(t)), undefined);
  assert.equal(readProjectConfig({ kind: 'url', path: tmp(t), name: 'x', units: [] }), undefined);
});

const warn = fakeEngine('warn', ['theme'], async () => [raw({ severity: 'warning' })]);
const run = (input: string, extra: object = {}) => runSession({ input, engines: [warn], ...extra });

test('runSession: the config sets preset, level and failOn', async (t) => {
  const h = home(t);
  write(path.join(h, 'presets', 'mine.json'), JSON.stringify({ schema: 1, title: 'Mine', summary: 'S', kinds: ['theme'], engines: ['warn'], level: 3, failOn: 'never' }));
  const dir = theme(t, { preset: 'mine', level: 8, failOn: 'important' });
  const s = await run(dir);
  assert.equal(s.result.preset, 'mine');
  assert.equal(s.result.level, 8);
  assert.equal(s.result.config, FILE);
  assert.equal(s.failOn, 'warning');
  assert.equal(s.configFile, path.join(dir, FILE));
  const json = JSON.parse(readFileSync(s.files.find((f) => f.endsWith('report.json'))!, 'utf8')) as { preset: string; level: number; config: string };
  assert.deepEqual([json.preset, json.level, json.config], ['mine', 8, FILE]);
  // Without a level in the config, and without failOn, the preset decides.
  const plain = await run(theme(t, { preset: 'mine' }));
  assert.deepEqual([plain.result.level, plain.failOn], [3, 'never']);
});

test('runSession: a caller preset or engine list beats the config, and config false ignores it', async (t) => {
  const h = home(t);
  write(path.join(h, 'presets', 'mine.json'), JSON.stringify({ schema: 1, title: 'Mine', summary: 'S', kinds: ['theme'], engines: ['warn'] }));
  const dir = theme(t, { preset: 'mine', failOn: 'never', level: 5 });
  const byPreset = await run(dir, { preset: 'wporg-theme' });
  assert.equal(byPreset.result.preset, 'wporg-theme');
  assert.equal(byPreset.result.level, 5);
  assert.equal(byPreset.failOn, 'never');
  const byOnly = await run(dir, { only: ['warn'] });
  assert.equal(byOnly.result.preset, undefined);
  const off = await run(dir, { config: false });
  assert.deepEqual([off.result.preset, off.result.level, off.result.config, off.failOn, off.configFile], [undefined, 6, undefined, undefined, undefined]);
  const engines = await run(theme(t, { engines: ['warn'] }));
  assert.deepEqual(engines.result.engines.map((e) => e.engine), ['warn']);
});

test('runSession: an invalid config or an unknown preset throws', async (t) => {
  home(t);
  await assert.rejects(run(theme(t, { assistant: 'claude' })), /wp-shakedown\.json is not valid: it cannot turn on an assistant/);
  await assert.rejects(run(theme(t, { preset: 'nope' })), /Unknown preset "nope"/);
});

test('hub: each project uses its own failOn, an explicit value wins', async (t) => {
  home(t);
  const strict = theme(t, { failOn: 'important' });
  const lax = theme(t, { failOn: 'never' });
  const rows = await runMany([strict, lax], { jobs: 1, session: { engines: [warn] } });
  assert.deepEqual(rows.map((r) => r.failOn), ['warning', 'never']);
  assert.equal(hubExitCode(rows), 1);
  assert.equal(hubExitCode(rows.slice(1)), 0);
  assert.equal(hubExitCode(rows, 'never'), 0);
  assert.equal(hubExitCode(rows.slice(1), 'info'), 1);
});

test('reports show the settings file', () => {
  const r = result([], { config: FILE });
  assert.match(toMarkdown(r), /\n- Settings: wp-shakedown\.json\n/);
  assert.match(toHtml(r), /Settings from wp-shakedown\.json, Run /);
  assert.match(toShort(r), /wp-shakedown 0\.0\.0, settings from wp-shakedown\.json\./);
  assert.doesNotMatch(toMarkdown(result()), /Settings/);
  assert.doesNotMatch(toHtml(result()), /Settings/);
  assert.doesNotMatch(toShort(result()), /settings from/);
});
