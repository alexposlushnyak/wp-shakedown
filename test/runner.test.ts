import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { exitCode, run } from '../src/runner.ts';
import { detectTarget } from '../src/target.ts';
import { EngineSkipped } from '../src/types.ts';
import type { RunEvent } from '../src/types.ts';
import { fakeEngine, finding, makeInstall, makeTheme, raw, result, tmp } from './helpers.ts';

const ok = (id: string, kinds: ('theme' | 'plugin' | 'install')[], findings = [raw()]) =>
  fakeEngine(id, kinds, async () => findings);

test('records ok, skipped and failed with reasons', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const r = await run(target, {
    engines: [
      ok('good', ['theme']),
      fakeEngine('skip', ['theme'], async () => { throw new EngineSkipped('PHP is missing.'); }),
      fakeEngine('bad', ['theme'], async () => { throw new Error('boom'); }),
      fakeEngine('str', ['theme'], async () => { throw 'plain'; }),
      ok('other-kind', ['plugin']),
    ],
  });
  assert.deepEqual(r.engines.map((e) => [e.engine, e.status, e.reason, e.findings]), [
    ['good', 'ok', undefined, 1],
    ['skip', 'skipped', 'PHP is missing.', 0],
    ['bad', 'failed', 'boom', 0],
    ['str', 'failed', 'plain', 0],
  ]);
  assert.equal(r.engines[0]!.unit, undefined);
});

test('fans out over install units with labels and root-relative files', async (t) => {
  const dir = makeInstall(tmp(t));
  const target = detectTarget(dir);
  const seen: string[] = [];
  const themeEngine = fakeEngine('th', ['theme'], async ({ target: tg }) => {
    seen.push(tg.path);
    return [raw({ location: { file: 'functions.php', line: 1 } })];
  });
  const pluginEngine = fakeEngine('pl', ['plugin'], async ({ target: tg }) => [
    raw({ location: { file: path.join(tg.path, 'whatever.php') } }),
  ]);
  const r = await run(target, { engines: [themeEngine, pluginEngine] });
  assert.equal(seen.length, 2);
  assert.deepEqual(r.engines.map((e) => [e.engine, e.unit]), [
    ['th', 'theme:a'], ['th', 'theme:b'], ['pl', 'plugin:folder-plugin'], ['pl', 'plugin:single'],
  ]);
  const byUnit = Object.fromEntries(r.findings.map((f) => [f.unit, f.location.file]));
  assert.equal(byUnit['theme:a'], 'wp-content/themes/a/functions.php');
  assert.equal(byUnit['plugin:folder-plugin'], 'wp-content/plugins/folder-plugin/whatever.php');
  assert.equal(byUnit['plugin:single'], 'wp-content/plugins/single.php');
  assert.deepEqual(r.target.units.map((u) => u.path), [
    'wp-content/themes/a', 'wp-content/themes/b', 'wp-content/plugins/folder-plugin', 'wp-content/plugins/single.php',
  ]);
  assert.match(r.findings[0]!.rerun, /^wp-shakedown run ".*" --engine (th|pl)$/);
});

test('an absolute file inside the target becomes relative', async (t) => {
  const dir = makeTheme(tmp(t));
  const target = detectTarget(dir);
  const r = await run(target, {
    engines: [fakeEngine('e', ['theme'], async () => [raw({ location: { file: path.join(target.path, 'inc', 'x.php') } }), raw({ rule: 'u', location: { url: 'http://x' } })])],
  });
  assert.deepEqual(r.findings.map((f) => f.location.file), [undefined, 'inc/x.php']);
});

test('only filters engines and an unknown id throws', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const engines = [ok('a', ['theme']), ok('b', ['theme'])];
  const r = await run(target, { engines, only: ['b'] });
  assert.deepEqual(r.engines.map((e) => e.engine), ['b']);
  await assert.rejects(run(target, { engines, only: ['zzz'] }), { message: 'Unknown engine "zzz". Known engines: a, b.' });
  await assert.rejects(run(target, { engines: [], only: ['zzz'] }), { message: 'Unknown engine "zzz". Known engines: none.' });
});

test('emits events in order', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const events: RunEvent[] = [];
  await run(target, { engines: [ok('a', ['theme'])], onEvent: (e) => events.push(e) });
  assert.deepEqual(events.map((e) => e.type), ['run:start', 'engine:start', 'engine:end', 'run:end']);
});

test('counts the summary and sorts findings', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const r = await run(target, {
    engines: [
      ok('e', ['theme'], [
        raw({ rule: 'z', severity: 'warning', message: 'w', location: { file: 'b.php', line: 2 } }),
        raw({ rule: 'a', severity: 'error', message: 'e1', location: { file: 'a.php', line: 10 } }),
        raw({ rule: 'a', severity: 'info', message: 'i', location: { file: 'a.php', line: 2 } }),
      ]),
    ],
    now: () => new Date('2026-02-03T04:05:06.000Z'),
  });
  assert.deepEqual(r.summary, { error: 1, warning: 1, info: 1, suppressed: 0 });
  assert.deepEqual(r.findings.map((f) => [f.location.file, f.location.line]), [['a.php', 2], ['a.php', 10], ['b.php', 2]]);
  assert.equal(r.startedAt, '2026-02-03T04:05:06.000Z');
  assert.ok(r.findings.every((f) => /^[0-9a-f]{12}$/.test(f.id)));
});

test('applies a baseline', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const engines = [ok('e', ['theme'])];
  const first = await run(target, { engines });
  const id = first.findings[0]!.id;
  const r = await run(target, { engines, baseline: { schema: 1, entries: [{ id, reason: 'known' }, { id: 'gone', reason: 'old' }] } });
  assert.deepEqual(r.summary, { error: 0, warning: 0, info: 0, suppressed: 1 });
  assert.deepEqual(r.staleBaseline, ['gone']);
});

test('an aborted signal stops later jobs', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const ac = new AbortController();
  const r = await run(target, {
    engines: [fakeEngine('first', ['theme'], async () => { ac.abort(); return []; }), ok('second', ['theme'])],
    signal: ac.signal,
  });
  assert.deepEqual(r.engines.map((e) => e.engine), ['first']);
});

test('exitCode covers each branch', () => {
  const failed = result([], { engines: [{ engine: 'x', status: 'failed', durationMs: 0, findings: 0 }] });
  assert.equal(exitCode(failed, 'never'), 2);
  const err = result([finding({ severity: 'error' })]);
  const warn = result([finding({ severity: 'warning' })]);
  assert.equal(exitCode(err, 'error'), 1);
  assert.equal(exitCode(warn, 'error'), 0);
  assert.equal(exitCode(warn, 'warning'), 1);
  assert.equal(exitCode(err, 'never'), 0);
  assert.equal(exitCode(result([finding({ suppressed: { reason: 'r' } })]), 'error'), 0);
});

test('reports stale baseline entries only after a complete run', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const a = ok('a', ['theme'], []);
  const skipped = fakeEngine('b', ['theme'], async () => {
    throw new EngineSkipped('PHP is missing');
  });
  const baseline = { schema: 1 as const, entries: [{ id: 'gone', reason: 'accepted' }] };
  assert.deepEqual((await run(target, { engines: [a], baseline })).staleBaseline, ['gone']);
  assert.deepEqual((await run(target, { engines: [a], only: ['a'], baseline })).staleBaseline, []);
  assert.deepEqual((await run(target, { engines: [a, skipped], baseline })).staleBaseline, []);
});
