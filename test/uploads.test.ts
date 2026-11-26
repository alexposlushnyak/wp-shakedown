import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { importZip, removeUpload, uploadsDir } from '../src/uploads.ts';
import { tmp, write, zipOf } from './helpers.ts';

function home(t: TestContext): string {
  const dir = tmp(t);
  const old = process.env.WP_SHAKEDOWN_HOME;
  process.env.WP_SHAKEDOWN_HOME = dir;
  t.after(() => {
    if (old === undefined) delete process.env.WP_SHAKEDOWN_HOME;
    else process.env.WP_SHAKEDOWN_HOME = old;
  });
  return dir;
}

const theme = (extra: { name: string; data?: string }[] = []) =>
  zipOf([{ name: 'aurora/style.css', data: '/*\nTheme Name: Aurora\nVersion: 1.0\n*/\n' }, { name: 'aurora/functions.php', data: '<?php\n' }, ...extra]);

const noTmp = () => assert.deepEqual(readdirSync(uploadsDir()).filter((n) => n.startsWith('.tmp-')), []);

test('a theme archive lands under uploads/themes/<slug>', (t) => {
  const h = home(t);
  const dest = importZip(theme(), 'aurora.zip');
  assert.equal(dest, path.join(h, 'uploads', 'themes', 'aurora'));
  assert.ok(existsSync(path.join(dest, 'style.css')));
  noTmp();
});

test('a plugin archive lands under uploads/plugins/<slug>', (t) => {
  const h = home(t);
  const zip = zipOf([{ name: 'cart/cart.php', data: '<?php\n/**\n * Plugin Name: Cart\n */\n' }]);
  assert.equal(importZip(zip, 'cart.zip'), path.join(h, 'uploads', 'plugins', 'cart'));
});

test('an archive with files at its root takes its slug from the archive name', (t) => {
  const h = home(t);
  const zip = zipOf([{ name: 'style.css', data: '/*\nTheme Name: Rooted\n*/\n' }, { name: 'functions.php', data: '<?php\n' }]);
  const dest = importZip(zip, 'My Theme 1.2.zip');
  assert.equal(dest, path.join(h, 'uploads', 'themes', 'My-Theme-1.2'));
  assert.ok(existsSync(path.join(dest, 'style.css')));
});

test('uploading again replaces the old files', (t) => {
  home(t);
  const dest = importZip(theme([{ name: 'aurora/old.php', data: '<?php\n' }]), 'aurora.zip');
  assert.ok(existsSync(path.join(dest, 'old.php')));
  importZip(theme(), 'aurora.zip');
  assert.ok(!existsSync(path.join(dest, 'old.php')));
  assert.ok(existsSync(path.join(dest, 'style.css')));
});

test('a busy folder throws and keeps the old one', (t) => {
  home(t);
  const dest = importZip(theme([{ name: 'aurora/old.php', data: '<?php\n' }]), 'aurora.zip');
  assert.throws(() => importZip(theme(), 'aurora.zip', (d) => d === dest), /running/);
  assert.ok(existsSync(path.join(dest, 'old.php')));
  noTmp();
});

test('an archive that is neither a theme nor a plugin throws and leaves no temp folder', (t) => {
  home(t);
  assert.throws(() => importZip(zipOf([{ name: 'notes/readme.txt', data: 'hi' }]), 'notes.zip'));
  assert.throws(() => importZip(Buffer.from('not a zip at all, just some text bytes'), 'x.zip'));
  noTmp();
});

test('removeUpload deletes under uploads and leaves other folders alone', (t) => {
  home(t);
  const dest = importZip(theme(), 'aurora.zip');
  const outside = tmp(t);
  write(path.join(outside, 'keep.txt'), 'x');
  removeUpload(outside);
  assert.ok(existsSync(path.join(outside, 'keep.txt')));
  removeUpload(dest);
  assert.ok(!existsSync(dest));
  mkdirSync(uploadsDir(), { recursive: true });
});
