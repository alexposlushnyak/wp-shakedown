import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  groupProjects,
  queueText,
  shortPath,
  aiPrompt,
  countsText,
  newerFirst,
  crumbs,
  defaultPair,
  runLink,
  runStamp,
  detectedText,
  fromSnapshot,
  jobStatusText,
  lastRunText,
  parseRoute,
  freeId,
  levelLabel,
  parseView,
  presetId,
  presetsFor,
  readLevel,
  progress,
  projectTone,
  runModel,
  timeAgo,
  withEvent,
} from '../ui/src/lib/run.ts';
import type { WireEvent } from '../ui/src/lib/run.ts';

const start: WireEvent = {
  type: 'run:start',
  target: { kind: 'theme', name: 'T', path: '/t', units: 0 },
  jobs: [{ engine: 'a' }, { engine: 'b' }],
};

test('detectedText describes each kind of target', () => {
  assert.equal(detectedText({ kind: 'theme', name: 'Aurora', units: [] }), 'Theme "Aurora"');
  assert.equal(
    detectedText({ kind: 'install', name: 'site', units: [{ kind: 'theme' }, { kind: 'plugin' }, { kind: 'plugin' }] }),
    'WordPress folder with 1 theme and 2 plugins',
  );
});

test('runModel follows a run from the events', () => {
  const events: WireEvent[] = [
    start,
    { type: 'engine:start', engine: 'a' },
    { type: 'engine:note', engine: 'a', message: 'Installing.' },
    { type: 'engine:end', run: { engine: 'a', status: 'ok', durationMs: 1200, findings: 3 } },
    { type: 'engine:start', engine: 'b' },
  ];
  const mid = runModel(events);
  assert.equal(mid.running, true);
  assert.deepEqual(mid.jobs.map((j) => j.status), ['ok', 'running']);
  assert.deepEqual(mid.jobs[0]!.notes, ['Installing.']);
  assert.equal(jobStatusText(mid.jobs[0]!), '3 findings');
  assert.equal(jobStatusText(mid.jobs[1]!), 'Running');
  assert.equal(progress(mid.jobs), 50);

  const done = runModel([
    ...events,
    { type: 'engine:end', run: { engine: 'b', status: 'skipped', durationMs: 5, findings: 0, reason: 'PHP is not installed.' } },
    { type: 'run:end', summary: { error: 0, warning: 3, info: 0, suppressed: 0 }, finishedAt: 'now' },
  ]);
  assert.equal(done.running, false);
  assert.equal(done.jobs[1]!.reason, 'PHP is not installed.');
  assert.equal(done.summary!.warning, 3);
  assert.equal(progress(done.jobs), 100);
});

test('runModel puts a stopped run back to waiting and keeps the message', () => {
  const m = runModel([start, { type: 'engine:start', engine: 'a' }, { type: 'run:error', message: 'The run was stopped.' }]);
  assert.equal(m.running, false);
  assert.equal(m.error, 'The run was stopped.');
  assert.equal(m.jobs[0]!.status, 'waiting');
});

test('a second run:start replaces the first run', () => {
  const m = runModel([start, { type: 'engine:start', engine: 'a' }, { ...start, jobs: [{ engine: 'c' }] }]);
  assert.deepEqual(m.jobs.map((j) => [j.engine, j.status]), [['c', 'waiting']]);
});

test('crumbs splits a path for the folder browser', () => {
  assert.deepEqual(crumbs('/Users/me/site'), [
    { name: '/', path: '/' },
    { name: 'Users', path: '/Users' },
    { name: 'me', path: '/Users/me' },
    { name: 'site', path: '/Users/me/site' },
  ]);
  assert.deepEqual(crumbs('C:\\work\\site'), [
    { name: 'C:', path: 'C:\\' },
    { name: 'work', path: 'C:\\work' },
    { name: 'site', path: 'C:\\work\\site' },
  ]);
});

test('aiPrompt names the report file', () => {
  assert.ok(aiPrompt('/r/report.md').includes('/r/report.md'));
});

test('presetsFor keeps the presets that fit the kind', () => {
  const all = [{ id: 'a', kinds: ['theme'] }, { id: 'b', kinds: ['plugin'] }, { id: 'c', kinds: ['theme', 'plugin'] }];
  assert.deepEqual(presetsFor(all, 'theme').map((p) => p.id), ['a', 'c']);
  assert.deepEqual(presetsFor(all, 'install'), []);
  assert.deepEqual(presetsFor(all, undefined), []);
});

const sum = (error: number, warning: number) => ({ error, warning, info: 4, suppressed: 0 });

test('lastRunText and projectTone describe the last run', () => {
  assert.equal(lastRunText(undefined), 'Not run yet');
  assert.equal(lastRunText({ summary: sum(0, 0), failed: 0 }), 'Clean');
  assert.equal(lastRunText({ summary: sum(2, 5), failed: 0 }), '2 critical, 5 important');
  assert.equal(lastRunText({ summary: sum(1, 0), failed: 0 }), '1 critical');
  assert.equal(lastRunText({ summary: sum(0, 1), failed: 0 }), '1 important');
  assert.equal(projectTone(undefined), 'none');
  assert.equal(projectTone({ summary: sum(0, 0), failed: 0 }), 'clean');
  assert.equal(projectTone({ summary: sum(0, 3), failed: 0 }), 'warning');
  assert.equal(projectTone({ summary: sum(1, 3), failed: 0 }), 'error');
  assert.equal(projectTone({ summary: sum(0, 0), failed: 1 }), 'error');
});

test('timeAgo rounds down to the unit', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  const ago = (ms: number) => timeAgo(new Date(now - ms).toISOString(), now);
  assert.equal(ago(30_000), 'just now');
  assert.equal(ago(5 * 60_000 + 1000), '5 min ago');
  assert.equal(ago(2.5 * 3600_000), '2 h ago');
  assert.equal(ago(3.5 * 86400_000), '3 d ago');
  assert.equal(timeAgo(new Date(now + 60_000).toISOString(), now), 'just now');
});

test('parseRoute opens a project only when it exists', () => {
  assert.equal(parseRoute('#/p/abc', ['abc']), 'abc');
  assert.equal(parseRoute('#/p/zzz', ['abc']), undefined);
  assert.equal(parseRoute('#/', ['abc']), undefined);
  assert.equal(parseRoute('', ['abc']), undefined);
});

test('events are kept per run and a run:start replaces that run only', () => {
  const a = withEvent(withEvent({}, 'a', start), 'a', { type: 'engine:start', engine: 'a' });
  const both = withEvent(a, 'b', start);
  assert.equal(both.a!.length, 2);
  assert.equal(both.b!.length, 1);
  assert.equal(withEvent(both, 'a', start).a!.length, 1);
  assert.deepEqual(fromSnapshot([{ id: 'x', events: [start] }]), { x: [start] });
});

test('groupProjects orders themes, plugins, folders, then what cannot be tested, and drops empty groups', () => {
  const p = (name: string, kind?: string) => ({ name, ...(kind ? { kind } : {}) });
  const groups = groupProjects([p('gone'), p('cart', 'plugin'), p('aurora', 'theme'), p('lumen', 'theme')]);
  assert.deepEqual(
    groups.map((g) => [g.title, g.projects.map((x) => x.name)]),
    [
      ['Themes', ['aurora', 'lumen']],
      ['Plugins', ['cart']],
      ['Cannot be tested', ['gone']],
    ],
  );
});

test('queueText counts running and queued projects', () => {
  assert.equal(queueText([{}, {}]), 'Idle');
  assert.equal(queueText([{ run: 'running' }, { run: 'running' }, { run: 'queued' }]), '2 running, 1 queued');
  assert.equal(queueText([{ run: 'queued' }]), '1 queued');
});

test('shortPath writes the home folder as ~ and leaves other paths alone', () => {
  assert.equal(shortPath('/Users/a/Sites/aurora', '/Users/a'), '~/Sites/aurora');
  assert.equal(shortPath('/Users/a', '/Users/a'), '~');
  assert.equal(shortPath('/Users/ab/x', '/Users/a'), '/Users/ab/x');
  assert.equal(shortPath('/tmp/x', ''), '/tmp/x');
});

test('groupProjects puts a kind without a group of its own into the last group', () => {
  const groups = groupProjects([{ name: 'site', kind: 'url' }, { name: 'gone' }]);
  assert.deepEqual(groups.map((g) => [g.title, g.projects.map((x) => x.name)]), [['Cannot be tested', ['site', 'gone']]]);
});

test('levelLabel names the levels that have a name', () => {
  assert.equal(levelLabel(6), 'Level 6, standard');
  assert.equal(levelLabel(3), 'Level 3, quick');
  assert.equal(levelLabel(7), 'Level 7');
});

test('readLevel takes a level, an old depth name, or falls back to 6', () => {
  assert.equal(readLevel('9'), 9);
  assert.equal(readLevel('0'), 0);
  assert.equal(readLevel('deep'), 8);
  assert.equal(readLevel('quick'), 3);
  assert.equal(readLevel(null), 6);
  assert.equal(readLevel(''), 6);
  assert.equal(readLevel('11'), 6);
  assert.equal(readLevel('2.5'), 6);
});

test('presetId makes a lowercase slug from a title', () => {
  assert.equal(presetId('Client site, strict!'), 'client-site-strict');
  assert.equal(presetId('  --x--  '), 'x');
});

test('parseView tells the list of presets, one preset, a project and the hub apart', () => {
  assert.deepEqual(parseView('#/presets', []), { view: 'presets' });
  assert.deepEqual(parseView('#/presets/client', []), { view: 'presets', id: 'client' });
  assert.deepEqual(parseView('#/presets/new?from=envato', []), { view: 'presets', id: 'new?from=envato' });
  assert.deepEqual(parseView('#/p/ab12cd34', ['ab12cd34']), { view: 'project', id: 'ab12cd34' });
  assert.deepEqual(parseView('#/p/gone', []), { view: 'hub' });
  assert.deepEqual(parseView('', []), { view: 'hub' });
});

test('freeId adds a number until the ID is free', () => {
  assert.equal(freeId('client-copy', ['client']), 'client-copy');
  assert.equal(freeId('client-copy', ['client-copy', 'client-copy-2']), 'client-copy-3');
});

test('the compare row starts with the two newest runs', () => {
  assert.equal(defaultPair([{ run: 'a' }]), undefined);
  assert.deepEqual(defaultPair([{ run: 'c' }, { run: 'b' }, { run: 'a' }]), { b: 'c', a: 'b' });
});

test('run labels and links', () => {
  assert.equal(countsText({ error: 1, warning: 2, info: 3, suppressed: 0 }), '1 / 2 / 3');
  assert.equal(runStamp('2026-11-27T10:41:03.123Z'), '2026-11-27 10:41 UTC');
  assert.equal(runLink('p1', 'r1', 't k'), '/api/report.html?id=p1&run=r1&t=t%20k');
  assert.equal(runLink('p1', 'r1', 'tk', 'r0'), '/api/report.html?id=p1&run=r1&against=r0&t=tk');
});

test('newerFirst opens the newer run whichever way the two were picked', () => {
  const runs = [{ run: 'c' }, { run: 'b' }, { run: 'a' }];
  assert.deepEqual(newerFirst(runs, 'c', 'a'), ['c', 'a']);
  assert.deepEqual(newerFirst(runs, 'a', 'c'), ['c', 'a']);
});
