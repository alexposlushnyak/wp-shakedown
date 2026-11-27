import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { exitCode, run } from '../src/runner.ts';
import { detectTarget } from '../src/target.ts';
import { EngineSkipped, parseLevel } from '../src/types.ts';
import type { RunEvent } from '../src/types.ts';
import { fakeEngine, finding, makeInstall, makeTheme, raw, result, tmp, write } from './helpers.ts';

const ok = (id: string, kinds: ('theme' | 'plugin' | 'install')[], findings = [raw()]) =>
  fakeEngine(id, kinds, async () => findings);

test('an engine sees the preset, and its variant goes into the run', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const seen: (string | undefined)[] = [];
  const directories: (string | undefined)[] = [];
  const engine = {
    ...fakeEngine('e', ['theme'], async (ctx) => (seen.push(ctx.preset), directories.push(ctx.directory), [])),
    variant: ({ directory }: { directory?: 'wporg' | 'envato' }) => directory,
  };
  const withPreset = await run(target, { engines: [engine], only: ['e'], preset: 'envato-copy', directory: 'envato' });
  assert.equal(withPreset.engines[0]!.variant, 'envato');
  assert.ok(!('variant' in (await run(target, { engines: [engine] })).engines[0]!));
  assert.deepEqual(seen, ['envato-copy', undefined]);
  assert.deepEqual(directories, ['envato', undefined]);
});

test('the preset goes into the result only when given', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const engines = [fakeEngine('e', ['theme'], async () => [])];
  assert.equal((await run(target, { engines, preset: 'site' })).preset, 'site');
  assert.ok(!('preset' in (await run(target, { engines }))));
});

test('a theme run lists the assistant checks, and a run of hand-picked engines does not', async (t) => {
  const dir = makeTheme(tmp(t));
  write(path.join(dir, 'functions.php'), '<?php\necho $x;\n');
  const target = detectTarget(dir);
  const engines = [fakeEngine('e', ['theme'], async () => [])];
  const listed = await run(target, { engines, level: 7 });
  assert.deepEqual(listed.assistant?.map((a) => a.id), ['escaping-context']);
  assert.ok(!('assistant' in (await run(target, { engines, level: 6 }))));
  assert.ok(!('assistant' in (await run(target, { engines, only: ['e'], level: 7 }))));
  assert.ok('assistant' in (await run(target, { engines, only: ['e'], preset: 'p', level: 7 })));
  assert.ok(!('assistant' in (await run(detectTarget(makeInstall(tmp(t))), { engines, level: 7 }))));
});

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

test('a WordPress folder runs the install engines and no code engine', async (t) => {
  const dir = makeInstall(tmp(t));
  const target = detectTarget(dir);
  const seen: string[] = [];
  const themeEngine = fakeEngine('th', ['theme'], async ({ target: tg }) => (seen.push(tg.path), [raw()]));
  const pluginEngine = fakeEngine('pl', ['plugin'], async ({ target: tg }) => (seen.push(tg.path), [raw()]));
  const installEngine = fakeEngine('in', ['install'], async ({ target: tg }) => (seen.push(tg.path), [raw({ location: { file: path.join(tg.path, 'wp-config.php') } })]));
  const events: string[] = [];
  const r = await run(target, { engines: [themeEngine, pluginEngine, installEngine], onEvent: (e) => e.type === 'run:start' && events.push(...e.jobs.map((j) => j.engine)) });
  assert.deepEqual(seen, [target.path]);
  assert.deepEqual(events, ['in']);
  assert.deepEqual(r.engines.map((e) => e.engine), ['in']);
  assert.equal(r.findings[0]!.location.file, 'wp-config.php');
  assert.equal(r.findings[0]!.unit, undefined);
  assert.deepEqual(r.target.units.map((u) => u.path), [
    'wp-content/themes/a', 'wp-content/themes/b', 'wp-content/plugins/folder-plugin', 'wp-content/plugins/single.php',
  ]);
  assert.match(r.findings[0]!.rerun, /^wp-shakedown run ".*" --engine in$/);
  // The rerun keeps the level, and a run with a directory reruns at level 10, where the directory rules run.
  const at8 = await run(detectTarget(makeTheme(tmp(t))), { engines: [ok('in', ['theme'])], level: 8 });
  assert.match(at8.findings[0]!.rerun, /--engine in --level 8$/);
  const withDir = await run(detectTarget(makeTheme(tmp(t))), { engines: [ok('in', ['theme'])], directory: 'wporg' });
  assert.match(withDir.findings[0]!.rerun, /--engine in --level 10$/);
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

const withLevel = (id: string, level = 6) => ({ ...ok(id, ['theme'], []), level });

test('the level filters engines and goes into the result', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const engines = [withLevel('q', 3), withLevel('s'), withLevel('d', 8)];
  const ids = async (o: Omit<Parameters<typeof run>[1], 'engines'>) => (await run(target, { engines, ...o })).engines.map((e) => e.engine);
  assert.deepEqual(await ids({ level: 3 }), ['q']);
  assert.deepEqual(await ids({}), ['q', 's']);
  assert.deepEqual(await ids({ level: 8 }), ['q', 's', 'd']);
  assert.deepEqual(await ids({ level: 3, only: ['d'] }), ['d']);
  assert.deepEqual(await ids({ level: 3, only: ['s', 'd'], preset: 'site' }), []);
  assert.equal((await run(target, { engines })).level, 6);
  assert.equal((await run(target, { engines, level: 3 })).level, 3);
});

test('an engine runs at its own level and not below it', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const engines = [withLevel('seven', 7)];
  const ids = async (level: number) => (await run(target, { engines, level })).engines.map((e) => e.engine);
  assert.deepEqual(await ids(6), []);
  assert.deepEqual(await ids(7), ['seven']);
  assert.deepEqual(await ids(10), ['seven']);
  assert.deepEqual(await ids(0), []);
});

test('an engine sees the level of the run', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const seen: number[] = [];
  const engine = fakeEngine('e', ['theme'], async (ctx) => (seen.push(ctx.level), []), 0);
  await run(target, { engines: [engine] });
  await run(target, { engines: [engine], level: 9 });
  assert.deepEqual(seen, [6, 9]);
});

test('parseLevel takes 0 to 10 and the three names', () => {
  assert.equal(parseLevel(0), 0);
  assert.equal(parseLevel(10), 10);
  assert.equal(parseLevel('7'), 7);
  assert.equal(parseLevel('quick'), 3);
  assert.equal(parseLevel('standard'), 6);
  assert.equal(parseLevel('deep'), 8);
  for (const bad of [-1, 11, 2.5, 'x', '', '11', '-1', '1.5', 'toString', NaN]) {
    assert.throws(() => parseLevel(bad), /Level must be a number from 0 to 10, or quick, standard or deep\./, String(bad));
  }
});

test('a level that left out a fitting engine keeps stale baseline entries quiet', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const baseline = { schema: 1 as const, entries: [{ id: 'gone', reason: 'accepted' }] };
  const a = withLevel('a');
  assert.deepEqual((await run(target, { engines: [a, withLevel('d', 8)], baseline })).staleBaseline, []);
  assert.deepEqual((await run(target, { engines: [a, withLevel('d', 8)], baseline, level: 8 })).staleBaseline, ['gone']);
  const other = { ...withLevel('p', 8), kinds: ['plugin' as const] };
  assert.deepEqual((await run(target, { engines: [a, other], baseline })).staleBaseline, ['gone']);
});
