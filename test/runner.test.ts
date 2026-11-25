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

test('an engine sees the profile, and its variant goes into the run', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const seen: (string | undefined)[] = [];
  const engine = { ...fakeEngine('e', ['theme'], async (ctx) => (seen.push(ctx.profile), [])), variant: (p: string | undefined) => (p === 'x' ? 'other' : undefined) };
  const withProfile = await run(target, { engines: [engine], only: ['e'], profile: 'x' });
  assert.equal(withProfile.engines[0]!.variant, 'other');
  assert.ok(!('variant' in (await run(target, { engines: [engine] })).engines[0]!));
  assert.deepEqual(seen, ['x', undefined]);
});

test('the profile goes into the result only when given', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const engines = [fakeEngine('e', ['theme'], async () => [])];
  assert.equal((await run(target, { engines, profile: 'site' })).profile, 'site');
  assert.ok(!('profile' in (await run(target, { engines }))));
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

const withDepth = (id: string, depth?: 'quick' | 'standard' | 'deep') => ({ ...ok(id, ['theme'], []), ...(depth ? { depth } : {}) });

test('depth filters engines and goes into the result', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const engines = [withDepth('q', 'quick'), withDepth('s'), withDepth('d', 'deep')];
  const ids = async (o: Omit<Parameters<typeof run>[1], 'engines'>) => (await run(target, { engines, ...o })).engines.map((e) => e.engine);
  assert.deepEqual(await ids({ depth: 'quick' }), ['q']);
  assert.deepEqual(await ids({}), ['q', 's']);
  assert.deepEqual(await ids({ depth: 'deep' }), ['q', 's', 'd']);
  assert.deepEqual(await ids({ depth: 'quick', only: ['d'] }), ['d']);
  assert.deepEqual(await ids({ depth: 'quick', only: ['s', 'd'], profile: 'site' }), []);
  assert.equal((await run(target, { engines })).depth, 'standard');
  assert.equal((await run(target, { engines, depth: 'quick' })).depth, 'quick');
});

test('a depth that left out a fitting engine keeps stale baseline entries quiet', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const baseline = { schema: 1 as const, entries: [{ id: 'gone', reason: 'accepted' }] };
  const a = withDepth('a');
  assert.deepEqual((await run(target, { engines: [a, withDepth('d', 'deep')], baseline })).staleBaseline, []);
  assert.deepEqual((await run(target, { engines: [a, withDepth('d', 'deep')], baseline, depth: 'deep' })).staleBaseline, ['gone']);
  const other = { ...withDepth('p', 'deep'), kinds: ['plugin' as const] };
  assert.deepEqual((await run(target, { engines: [a, other], baseline })).staleBaseline, ['gone']);
});

const experimental = (id: string) => ({ ...withDepth(id), experimental: true as const });

test('experimental engines run only on request or by name', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const engines = [withDepth('s'), experimental('x')];
  const ids = async (o: Omit<Parameters<typeof run>[1], 'engines'>) => (await run(target, { engines, ...o })).engines.map((e) => e.engine);
  assert.deepEqual(await ids({}), ['s']);
  assert.deepEqual(await ids({ experimental: true }), ['s', 'x']);
  assert.deepEqual(await ids({ only: ['x'] }), ['x']);
  assert.deepEqual(await ids({ only: ['x'], profile: 'wporg-theme' }), []);
  assert.deepEqual(await ids({ only: ['x'], profile: 'wporg-theme', experimental: true }), ['x']);
  assert.equal((await run(target, { engines, experimental: true })).experimental, true);
  assert.ok(!('experimental' in (await run(target, { engines }))));
});

test('an experimental engine that was left out keeps stale baseline entries quiet', async (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const baseline = { schema: 1 as const, entries: [{ id: 'gone', reason: 'accepted' }] };
  const a = withDepth('a');
  assert.deepEqual((await run(target, { engines: [a, experimental('x')], baseline })).staleBaseline, []);
  assert.deepEqual((await run(target, { engines: [a, experimental('x')], baseline, experimental: true })).staleBaseline, ['gone']);
});
