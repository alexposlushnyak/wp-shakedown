import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aiPrompt,
  crumbs,
  detectedText,
  fromSnapshot,
  jobStatusText,
  lastRunText,
  parseRoute,
  profilesFor,
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
  jobs: [{ engine: 'a' }, { engine: 'b', unit: 'theme:x' }],
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
    { type: 'engine:start', engine: 'b', unit: 'theme:x' },
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
    { type: 'engine:end', run: { engine: 'b', unit: 'theme:x', status: 'skipped', durationMs: 5, findings: 0, reason: 'PHP is not installed.' } },
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

test('profilesFor keeps the profiles that fit the kind', () => {
  const all = [{ id: 'a', kinds: ['theme'] }, { id: 'b', kinds: ['plugin'] }, { id: 'c', kinds: ['theme', 'plugin'] }];
  assert.deepEqual(profilesFor(all, 'theme').map((p) => p.id), ['a', 'c']);
  assert.deepEqual(profilesFor(all, 'install'), []);
  assert.deepEqual(profilesFor(all, undefined), []);
});

const sum = (error: number, warning: number) => ({ error, warning, info: 4, suppressed: 0 });

test('lastRunText and projectTone describe the last run', () => {
  assert.equal(lastRunText(undefined), 'Not run yet');
  assert.equal(lastRunText({ summary: sum(0, 0), failed: 0 }), 'Clean');
  assert.equal(lastRunText({ summary: sum(2, 5), failed: 0 }), '2 errors, 5 warnings');
  assert.equal(lastRunText({ summary: sum(1, 0), failed: 0 }), '1 error');
  assert.equal(lastRunText({ summary: sum(0, 1), failed: 0 }), '1 warning');
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
