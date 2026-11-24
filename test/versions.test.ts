import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, inRange } from '../src/versions.ts';

test('compareVersions orders versions', () => {
  assert.ok(compareVersions('6.8', '6.8.1') < 0);
  assert.ok(compareVersions('1.10', '1.9') > 0);
  assert.equal(compareVersions('2.0', '2.0.0'), 0);
  assert.ok(compareVersions('1.0-beta', '1.0') < 0);
  assert.ok(compareVersions('5.3.2', '5.4') < 0);
});

test('inRange honours bounds', () => {
  assert.ok(inRange('1.0', { min: '1.0', minInclusive: true }));
  assert.ok(!inRange('1.0', { min: '1.0' }));
  assert.ok(inRange('2.0', { max: '2.0', maxInclusive: true }));
  assert.ok(!inRange('2.0', { max: '2.0' }));
  assert.ok(inRange('9.9', { min: null, max: '*' }));
  assert.ok(inRange('9.9', {}));
  assert.ok(!inRange('0.9', { min: '1.0', minInclusive: true, max: '2.0' }));
});
