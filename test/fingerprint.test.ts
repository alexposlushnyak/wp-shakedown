import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignIds } from '../src/fingerprint.ts';

const item = (over: { message?: string; line?: number } = {}) => ({
  engine: 'e',
  rule: 'r',
  message: over.message ?? 'm',
  location: { file: 'a.php', line: over.line ?? 1 },
});

test('a different line keeps the id', () => {
  assert.equal(assignIds([item({ line: 1 })])[0]!.id, assignIds([item({ line: 99 })])[0]!.id);
});

test('identical findings get different, repeatable ids', () => {
  const items = [item({ line: 20 }), item({ line: 10 })];
  const a = assignIds(items);
  const b = assignIds(items);
  assert.notEqual(a[0]!.id, a[1]!.id);
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
  // The earlier line keeps the plain id.
  assert.equal(a[1]!.id, assignIds([item()])[0]!.id);
});

test('a different message changes the id', () => {
  assert.notEqual(assignIds([item()])[0]!.id, assignIds([item({ message: 'other' })])[0]!.id);
});
