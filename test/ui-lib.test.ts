import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aiPrompt,
  crumbs,
  detectedText,
  filterFindings,
  groupByFile,
  jobStatusText,
  progress,
  runModel,
  severityCounts,
  styleCounts,
  summaryText,
} from '../ui/src/lib/run.ts';
import type { WireEvent } from '../ui/src/lib/run.ts';
import { finding } from './helpers.ts';

const start: WireEvent = {
  type: 'run:start',
  target: { kind: 'theme', name: 'T', path: '/t', units: 0 },
  jobs: [{ engine: 'a' }, { engine: 'b', unit: 'theme:x' }],
};

test('summaryText matches the terminal wording', () => {
  assert.equal(summaryText({ error: 1, warning: 0, info: 2, suppressed: 0 }), '1 error, 0 warnings, 2 notes.');
  assert.equal(summaryText({ error: 0, warning: 1, info: 1, suppressed: 3 }), '0 errors, 1 warning, 1 note. 3 suppressed.');
});

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

test('filterFindings leaves out style and suppressed findings unless asked', () => {
  const all = [
    finding({ id: 'e1', severity: 'error', message: 'Not escaped', engine: 'wpcs' }),
    finding({ id: 's1', severity: 'warning', category: 'standards', engine: 'wpcs' }),
    finding({ id: 'x1', severity: 'error', suppressed: { reason: 'r' } }),
    finding({ id: 'w1', severity: 'warning', engine: 'phpstan', location: { file: 'inc/a.php' } }),
  ];
  assert.deepEqual(filterFindings(all, {}).map((f) => f.id), ['e1', 'w1']);
  assert.deepEqual(filterFindings(all, { style: true }).map((f) => f.id), ['e1', 's1', 'w1']);
  assert.deepEqual(filterFindings(all, { severity: 'error' }).map((f) => f.id), ['e1']);
  assert.deepEqual(filterFindings(all, { engine: 'phpstan' }).map((f) => f.id), ['w1']);
  assert.deepEqual(filterFindings(all, { text: 'ESCAPED' }).map((f) => f.id), ['e1']);
  assert.deepEqual(filterFindings(all, { text: 'inc/a' }).map((f) => f.id), ['w1']);
  assert.deepEqual(severityCounts(all, false), { error: 1, warning: 1, info: 0 });
  assert.deepEqual(severityCounts(all, true), { error: 1, warning: 2, info: 0 });
});

test('groupByFile and styleCounts', () => {
  const all = [
    finding({ id: 'a', location: { file: 'a.php' } }),
    finding({ id: 'b', location: { file: 'b.php' } }),
    finding({ id: 'c', location: { file: 'a.php' } }),
    finding({ id: 's1', category: 'standards', rule: 'Sp.A' }),
    finding({ id: 's2', category: 'standards', rule: 'Sp.A' }),
    finding({ id: 's3', category: 'standards', rule: 'Sp.B' }),
  ];
  assert.deepEqual(groupByFile(all.slice(0, 3)).map((g) => [g.file, g.items.length]), [['a.php', 2], ['b.php', 1]]);
  assert.deepEqual(styleCounts(all), [{ rule: 'fake: Sp.A', count: 2 }, { rule: 'fake: Sp.B', count: 1 }]);
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
