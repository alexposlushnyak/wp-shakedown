import assert from 'node:assert/strict';
import { test } from 'node:test';
import { engines } from '../src/engines/index.ts';
import { profileEngines, profiles } from '../src/profiles.ts';
import { detectTarget } from '../src/target.ts';
import { makePlugin, makeTheme, tmp } from './helpers.ts';

test('every engine of every profile exists', () => {
  const ids = engines.map((e) => e.id);
  for (const p of profiles) for (const id of p.engines) assert.ok(ids.includes(id), `${p.id} names ${id}`);
});

test('profileEngines returns the list and rejects a wrong profile', (t) => {
  const theme = detectTarget(makeTheme(tmp(t)));
  assert.deepEqual(profileEngines('wporg-theme', theme), profiles.find((p) => p.id === 'wporg-theme')!.engines);
  assert.throws(() => profileEngines('x', theme), /Unknown profile "x"/);
  const plugin = detectTarget(makePlugin(tmp(t), 'My Plugin'));
  assert.throws(() => profileEngines('wporg-theme', plugin), /checks a theme. "My Plugin" is a plugin/);
});
