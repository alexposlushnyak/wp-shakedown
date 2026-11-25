import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import './env.ts';
import { integrity } from '../src/engines/integrity.ts';
import { run } from '../src/runner.ts';
import { detectTarget } from '../src/target.ts';
import type { RunEvent } from '../src/types.ts';
import { fakeNet, tmp, write } from './helpers.ts';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const CORE = 'https://api.wordpress.org/core/checksums/1.0/?version=6.8&locale=en_US';
const PLUGIN = 'https://downloads.wordpress.org/plugin-checksums/pl/1.0.json';
const VERSION = "<?php $wp_version = '6.8';\n";

function site(t: Parameters<typeof tmp>[0]) {
  const dir = tmp(t);
  write(path.join(dir, 'wp-includes/version.php'), VERSION);
  write(path.join(dir, 'wp-admin/index.php'), 'admin');
  write(path.join(dir, 'index.php'), 'index');
  write(path.join(dir, 'wp-content/plugins/pl/pl.php'), '<?php\n/*\nPlugin Name: Pl\nVersion: 1.0\n*/\n');
  const sums = { 'wp-includes/version.php': md5(VERSION), 'wp-admin/index.php': md5('admin'), 'index.php': md5('index') };
  const routes = new Map<string, { status: number; body?: unknown }>([[CORE, { status: 200, body: { checksums: sums } }]]);
  return { dir, sums, routes };
}

async function go(dir: string) {
  const notes: string[] = [];
  const res = await run(detectTarget(dir), { engines: [integrity], onEvent: (e: RunEvent) => { if (e.type === 'engine:note') notes.push(e.message); } });
  return { res, notes, rules: res.findings.map((f) => f.rule) };
}

test('integrity: a clean install has no findings', async (t) => {
  const s = site(t);
  s.routes.set(PLUGIN, { status: 200, body: { files: { 'pl.php': { md5: md5('<?php\n/*\nPlugin Name: Pl\nVersion: 1.0\n*/\n') } } } });
  fakeNet(t, s.routes);
  const r = await go(s.dir);
  assert.deepEqual(r.rules, []);
  assert.equal(r.res.engines[0]!.status, 'ok');
});

test('integrity: modified, missing and unexpected core files', async (t) => {
  const s = site(t);
  s.routes.set(PLUGIN, { status: 404 });
  fakeNet(t, s.routes);
  write(path.join(s.dir, 'wp-admin/index.php'), 'changed');
  rmSync(path.join(s.dir, 'index.php'));
  write(path.join(s.dir, 'wp-includes/evil.php'), 'x');
  write(path.join(s.dir, 'wp-includes/.DS_Store'), 'x');
  const r = await go(s.dir);
  const by = (rule: string) => r.res.findings.find((f) => f.rule === rule)!;
  assert.equal(by('core.modified').severity, 'error');
  assert.equal(by('core.modified').location.file, 'wp-admin/index.php');
  assert.equal(by('core.missing').location.file, 'index.php');
  assert.equal(by('core.unexpected').location.file, 'wp-includes/evil.php');
  assert.equal(r.res.findings.length, 3);
  assert.ok(r.notes.some((n) => n === '1 plugin has no checksums on wordpress.org and was not compared.'));
});

test('integrity: no checksums gives a note', async (t) => {
  const s = site(t);
  s.routes.set(CORE, { status: 200, body: { checksums: false } });
  s.routes.set(PLUGIN, { status: 404 });
  fakeNet(t, s.routes);
  const r = await go(s.dir);
  assert.deepEqual(r.rules, []);
  assert.ok(r.notes.includes('wordpress.org has no checksums for WordPress 6.8. Core files were not compared.'));
});

test('integrity: a wrong plugin checksum is modified', async (t) => {
  const s = site(t);
  // readme.txt is in the list with a wrong checksum: wordpress.org changes it without a release, so it is left out.
  s.routes.set(PLUGIN, { status: 200, body: { files: { 'pl.php': { md5: ['aaa', 'bbb'] }, 'gone.php': { md5: 'ccc' }, 'readme.txt': { md5: 'ddd' } } } });
  fakeNet(t, s.routes);
  const r = await go(s.dir);
  assert.deepEqual(r.rules.sort(), ['plugin.missing', 'plugin.modified']);
  assert.equal(r.res.findings.find((f) => f.rule === 'plugin.modified')!.location.file, 'wp-content/plugins/pl/pl.php');
});

test('integrity: a lost network skips the engine', async (t) => {
  const s = site(t);
  fakeNet(t, new Map());
  const r = await go(s.dir);
  assert.equal(r.res.engines[0]!.status, 'skipped');
  assert.ok(r.res.engines[0]!.reason!.endsWith('This engine needs the network.'));
});
