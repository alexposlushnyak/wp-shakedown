import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import './env.ts';
import { daysSince, updates } from '../src/engines/updates.ts';
import { detectTarget } from '../src/target.ts';
import { fakeNet, tmp, write } from './helpers.ts';

const CORE = 'https://api.wordpress.org/core/version-check/1.7/';
const plugin = (slug: string) =>
  `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request%5Bslug%5D=${slug}&request%5Bfields%5D%5Bsections%5D=0`;
const theme = (slug: string) => `https://api.wordpress.org/themes/info/1.2/?action=theme_information&request%5Bslug%5D=${slug}`;

function setup(t: Parameters<typeof tmp>[0], routes: [string, { status: number; body?: unknown }][]) {
  const dir = tmp(t);
  write(path.join(dir, 'wp-includes/version.php'), "<?php $wp_version = '6.8';\n");
  write(path.join(dir, 'wp-content/plugins/pl/pl.php'), '<?php\n/*\nPlugin Name: Pl\nVersion: 1.0\n*/\n');
  write(path.join(dir, 'wp-content/themes/th/style.css'), '/*\nTheme Name: Th\nVersion: 1.0\n*/\n');
  fakeNet(t, new Map([[CORE, { status: 200, body: { offers: [{ version: '6.8' }] } }], ...routes]));
  return detectTarget(dir);
}
const go = (target: ReturnType<typeof detectTarget>) => updates.run({ target, note() {} });
const rules = (f: { rule: string }[]) => f.map((x) => x.rule);

test('updates: core and plugin outdated', async (t) => {
  const target = setup(t, [[plugin('pl'), { status: 200, body: { version: '1.2', last_updated: '2999-01-01 1:00am GMT' } }], [theme('th'), { status: 404, body: { error: 'x' } }]]);
  fakeNet(t, new Map([[CORE, { status: 200, body: { offers: [{ version: '6.9' }] } }], [plugin('pl'), { status: 200, body: { version: '1.2' } }], [theme('th'), { status: 404 }]]));
  const f = await go(target);
  assert.deepEqual(rules(f), ['core.outdated', 'plugin.outdated']);
  assert.equal(f[0]!.message, 'WordPress 6.8 is installed. The current version is 6.9.');
});

test('updates: abandoned, closed and theme outdated', async (t) => {
  const old = new Date(Date.now() - 3 * 365 * 86400000).toISOString().slice(0, 10);
  const target = setup(t, [[plugin('pl'), { status: 200, body: { version: '1.0', last_updated: `${old} 3:00pm GMT` } }], [theme('th'), { status: 200, body: { version: '2.0', last_updated: old } }]]);
  const f = await go(target);
  assert.deepEqual(rules(f), ['theme.outdated', 'theme.abandoned', 'plugin.abandoned']);
  assert.equal(f[2]!.message, `Pl had its last release on ${old}.`);
});

test('updates: closed plugin, plain 404 gives nothing', async (t) => {
  const closed = await go(setup(t, [[plugin('pl'), { status: 404, body: { error: 'closed' } }], [theme('th'), { status: 404, body: { error: 'Theme not found' } }]]));
  assert.deepEqual(rules(closed), ['plugin.closed']);
  const plain = await go(setup(t, [[plugin('pl'), { status: 404, body: { error: 'Plugin not found.' } }], [theme('th'), { status: 404 }]]));
  assert.deepEqual(plain, []);
});

test('daysSince counts whole days', () => {
  const now = new Date('2026-01-11T12:00:00Z');
  assert.equal(daysSince('2026-01-01 3:00pm GMT', now), 10);
  assert.equal(daysSince('nope', now), undefined);
});
