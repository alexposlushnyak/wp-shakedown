import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffRuns } from '../src/diff.ts';
import { finding, result } from './helpers.ts';

test('splits fixed, added and open', () => {
  const prev = result([finding({ id: 'a' }), finding({ id: 'b' })]);
  const cur = result([finding({ id: 'b' }), finding({ id: 'c' })]);
  const d = diffRuns(prev, cur);
  assert.deepEqual(d.fixed.map((f) => f.id), ['a']);
  assert.deepEqual(d.added.map((f) => f.id), ['c']);
  assert.deepEqual(d.open.map((f) => f.id), ['b']);
});

test('ignores suppressed findings', () => {
  const prev = result([finding({ id: 'a' })]);
  const cur = result([finding({ id: 'a', suppressed: { reason: 'r' } })]);
  const d = diffRuns(prev, cur);
  assert.deepEqual(d.fixed.map((f) => f.id), ['a']);
  assert.equal(d.added.length + d.open.length, 0);
});

test('leaves out an engine that did not run this time', () => {
  const prev = result([finding({ id: 'a' }), finding({ id: 'b', engine: 'other' })], {
    engines: [
      { engine: 'fake', status: 'ok', durationMs: 1, findings: 1 },
      { engine: 'other', status: 'ok', durationMs: 1, findings: 1 },
    ],
  });
  const cur = result([finding({ id: 'a' })]);
  const d = diffRuns(prev, cur);
  assert.deepEqual(d.fixed, []);
  assert.deepEqual(d.open.map((f) => f.id), ['a']);
});

test('leaves out an engine that was skipped this time', () => {
  const prev = result([finding({ id: 'a' })]);
  const cur = result([], { engines: [{ engine: 'fake', status: 'skipped', durationMs: 1, findings: 0, reason: 'PHP is missing' }] });
  const d = diffRuns(prev, cur);
  assert.equal(d.fixed.length + d.added.length + d.open.length, 0);
});

test('leaves out an engine that ran another variant of its tool', () => {
  const prev = result([finding({ id: 'a' })]);
  const cur = result([finding({ id: 'b' })], { engines: [{ engine: 'fake', status: 'ok', durationMs: 1, findings: 1, variant: 'envato' }] });
  const d = diffRuns(prev, cur);
  assert.equal(d.fixed.length + d.added.length + d.open.length, 0);
  const again = diffRuns(cur, result([finding({ id: 'b' })], { engines: [{ engine: 'fake', status: 'ok', durationMs: 1, findings: 1, variant: 'envato' }] }));
  assert.deepEqual(again.open.map((f) => f.id), ['b']);
});
