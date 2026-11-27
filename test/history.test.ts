import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { KEEP_RUNS, listRuns, previousOf, readRun, resolveRun, saveRun } from '../src/history.ts';
import './env.ts';
import { result, tmp, write } from './helpers.ts';

const at = (n: number) => result([], { finishedAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z` });
const ids = (dir: string) => readdirSync(path.join(dir, 'runs')).sort();

test('saveRun writes runs/<id>/report.json and numbers a repeated time', (t) => {
  const dir = tmp(t);
  const id = saveRun(dir, at(1));
  assert.equal(id, '2026-01-01T00-00-01-000Z');
  assert.ok(existsSync(path.join(dir, 'runs', id, 'report.json')));
  assert.equal(saveRun(dir, at(1)), `${id}-2`);
  assert.equal(saveRun(dir, at(1)), `${id}-3`);
});

test('saveRun keeps the newest KEEP_RUNS runs', (t) => {
  const dir = tmp(t);
  for (let i = 0; i < KEEP_RUNS + 3; i++) saveRun(dir, at(i));
  const left = ids(dir);
  assert.equal(left.length, KEEP_RUNS);
  assert.equal(left[0], '2026-01-01T00-00-03-000Z');
});

test('the previous report is saved only when runs/ is empty', (t) => {
  const dir = tmp(t);
  saveRun(dir, at(2), at(1));
  assert.equal(ids(dir).length, 2);
  saveRun(dir, at(3), at(2));
  assert.equal(ids(dir).length, 3);
});

test('listRuns is newest first and skips a broken folder', (t) => {
  const dir = tmp(t);
  saveRun(dir, at(1));
  saveRun(dir, result([], { finishedAt: '2026-01-01T00:00:02.000Z', preset: 'p', engines: [{ engine: 'x', status: 'failed', durationMs: 1, findings: 0 }] }));
  write(path.join(dir, 'runs', '2026-01-01T00-00-09-000Z', 'report.json'), 'not json');
  write(path.join(dir, 'runs', 'notes', 'report.json'), '{}');
  const list = listRuns(dir);
  assert.deepEqual(list.map((e) => e.finishedAt), ['2026-01-01T00:00:02.000Z', '2026-01-01T00:00:01.000Z']);
  assert.equal(list[0]!.failed, 1);
  assert.equal(list[0]!.preset, 'p');
  assert.deepEqual(listRuns(path.join(dir, 'none')), []);
});

test('readRun reads a run and refuses anything that is not a run id', (t) => {
  const dir = tmp(t);
  const id = saveRun(dir, at(1));
  write(path.join(dir, 'report.json'), JSON.stringify(at(5)));
  assert.equal(readRun(dir, id)?.finishedAt, '2026-01-01T00:00:01.000Z');
  for (const bad of ['../x', '..', '/etc/passwd', 'a/b', `${id}/../..`, '']) assert.equal(readRun(dir, bad), undefined, bad);
  assert.equal(readRun(dir, '2026-01-01T00-00-09-000Z'), undefined);
});

test('resolveRun takes a number or an id, previousOf the next older run', (t) => {
  const dir = tmp(t);
  for (let i = 1; i <= 3; i++) saveRun(dir, at(i));
  const list = listRuns(dir);
  assert.equal(resolveRun(list, '1'), list[0]);
  assert.equal(resolveRun(list, '3'), list[2]);
  assert.equal(resolveRun(list, '4'), undefined);
  assert.equal(resolveRun(list, '0'), undefined);
  assert.equal(resolveRun(list, list[1]!.run), list[1]);
  assert.equal(resolveRun(list, 'nope'), undefined);
  assert.equal(previousOf(list, list[0]!.run), list[1]);
  assert.equal(previousOf(list, list[2]!.run), undefined);
  assert.equal(previousOf(list, 'nope'), undefined);
});
