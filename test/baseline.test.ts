import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { applyBaseline, loadBaseline } from '../src/baseline.ts';
import { finding, tmp, write } from './helpers.ts';

function load(t: Parameters<typeof tmp>[0], text: string): { file: string; run: () => unknown } {
  const file = write(path.join(tmp(t), 'b.json'), text);
  return { file, run: () => loadBaseline(file) };
}

test('loads a valid baseline', (t) => {
  const b = load(t, '{"schema":1,"entries":[{"id":"x","reason":"ok"}]}');
  assert.deepEqual(b.run(), { schema: 1, entries: [{ id: 'x', reason: 'ok' }] });
});

test('each bad shape has its message', (t) => {
  let b = load(t, 'nope');
  assert.throws(b.run, { message: `The baseline file "${b.file}" is not valid JSON.` });
  b = load(t, '{"schema":2,"entries":[]}');
  assert.throws(b.run, { message: `The baseline file "${b.file}" must look like { "schema": 1, "entries": [] }.` });
  b = load(t, '{"schema":1,"entries":{}}');
  assert.throws(b.run, { message: `The baseline file "${b.file}" must look like { "schema": 1, "entries": [] }.` });
  b = load(t, '{"schema":1,"entries":[{"id":"a","reason":"r"},{"reason":"r"}]}');
  assert.throws(b.run, { message: `Entry 2 in "${b.file}" has no id.` });
  b = load(t, '{"schema":1,"entries":[{"id":"a","reason":"  "}]}');
  assert.throws(b.run, { message: `Entry 1 in "${b.file}" has no reason. Every suppressed finding needs one.` });
});

test('suppresses matches and reports stale ids', () => {
  const f = [finding({ id: 'one' }), finding({ id: 'two' })];
  const r = applyBaseline(f, { schema: 1, entries: [{ id: 'two', reason: 'why' }, { id: 'old', reason: 'x' }] });
  assert.equal(r.findings[0]!.suppressed, undefined);
  assert.deepEqual(r.findings[1]!.suppressed, { reason: 'why' });
  assert.deepEqual(r.stale, ['old']);
  assert.equal(f[1]!.suppressed, undefined);
});

test('names a baseline file it cannot read', () => {
  assert.throws(() => loadBaseline('/no/such/baseline.json'), { message: 'Cannot read the baseline file "/no/such/baseline.json".' });
});
