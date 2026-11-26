import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { hubExitCode, hubLines, projectTable, runMany } from '../src/hub.ts';
import type { HubRow } from '../src/hub.ts';
import { fakeEngine, finding, makeTheme, raw, result, tmp } from './helpers.ts';

function home(t: TestContext): void {
  const dir = tmp(t);
  const old = process.env.WP_SHAKEDOWN_HOME;
  process.env.WP_SHAKEDOWN_HOME = dir;
  t.after(() => {
    if (old === undefined) delete process.env.WP_SHAKEDOWN_HOME;
    else process.env.WP_SHAKEDOWN_HOME = old;
  });
}

const one = fakeEngine('one', ['theme'], async () => [raw()]);

test('runMany runs in order, reports the states and gives results', async (t) => {
  home(t);
  const a = makeTheme(tmp(t), 'Alpha');
  const b = makeTheme(tmp(t), 'Beta');
  const seen = new Set<string>();
  const rows = await runMany([a, b], { jobs: 1, session: { engines: [one] }, onChange: (_r, row) => seen.add(row.state) });
  assert.deepEqual(rows.map((r) => [r.name, r.state]), [['Alpha', 'done'], ['Beta', 'done']]);
  assert.ok(seen.has('running'));
  assert.equal(rows[0]!.result!.summary.error, 1);
  assert.equal(rows[0]!.done, 1);
  assert.ok(rows[0]!.reportFile);
});

test('a run that throws fails its row and the other row still runs', async (t) => {
  home(t);
  const b = makeTheme(tmp(t), 'Beta');
  const rows = await runMany(['/no/such/folder', b], { jobs: 1, session: { engines: [one] } });
  assert.equal(rows[0]!.state, 'failed');
  assert.match(rows[0]!.error!, /is not a folder/);
  assert.equal(rows[1]!.state, 'done');
});

test('jobs: 2 runs two at once', async (t) => {
  home(t);
  let active = 0;
  let peak = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = fakeEngine('slow', ['theme'], async () => {
    active++;
    peak = Math.max(peak, active);
    if (active === 2) release();
    await gate;
    active--;
    return [];
  });
  const rows = await runMany([makeTheme(tmp(t), 'A'), makeTheme(tmp(t), 'B')], { jobs: 2, session: { engines: [slow] } });
  assert.equal(peak, 2);
  assert.ok(rows.every((r) => r.state === 'done'));
});

test('hubLines formats the four states and cuts to the width', () => {
  const base = { path: '/x', total: 0, done: 0 };
  const done = result([finding()]);
  done.engines.push({ engine: 'b', status: 'failed', durationMs: 1, findings: 0, reason: 'x' });
  const rows: HubRow[] = [
    { ...base, name: 'a', state: 'waiting' },
    { ...base, name: 'long-name', state: 'running', total: 4, done: 1, current: 'wpcs theme:x' },
    { ...base, name: 'c', state: 'done', result: done },
    { ...base, name: 'd', state: 'failed', error: 'boom' },
  ];
  assert.deepEqual(hubLines(rows, 200), [
    '  a          waiting',
    '  long-name  1/4  wpcs theme:x',
    '  c          1 critical, 0 important, 0 recommended. 1 engine failed.',
    '  d          failed: boom',
  ]);
  assert.equal(hubLines(rows, 8)[1], '  long-n');
});

test('hubExitCode', () => {
  const clean = result();
  const bad = result([finding()]);
  const row = (r?: ReturnType<typeof result>): HubRow => ({ name: 'n', path: '/x', total: 0, done: 0, state: r ? 'done' : 'failed', ...(r ? { result: r } : {}) });
  assert.equal(hubExitCode([row(clean), row(clean)], 'error'), 0);
  assert.equal(hubExitCode([row(clean), row(bad)], 'error'), 1);
  assert.equal(hubExitCode([row(bad)], 'never'), 0);
  assert.equal(hubExitCode([row(bad), row()], 'error'), 2);
});

test('projectTable groups themes, plugins and folders and pads columns', () => {
  const p = { id: 'aaaaaaaa', path: '/x/alpha', name: 'Alpha', kind: 'theme' as const, units: 0 };
  const lines = projectTable([
    { ...p, id: 'bbbbbbbb', name: 'B', kind: undefined, problem: 'gone' },
    { ...p, id: 'cccccccc', name: 'Cart', kind: 'plugin', path: '/x/cart' },
    p,
  ]).split('\n');
  assert.deepEqual(lines, [
    'ID        Name   Last run  Critical  Important  Recommended  Path',
    '',
    'Themes',
    'aaaaaaaa  Alpha  never     -         -          -            /x/alpha',
    '',
    'Plugins',
    'cccccccc  Cart   never     -         -          -            /x/cart',
    '',
    'Cannot be tested',
    'bbbbbbbb  B      gone      -         -          -            /x/alpha',
  ]);
});
