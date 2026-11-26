import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { unzip } from '../src/zip.ts';
import { tmp, zipOf } from './helpers.ts';

test('unzip extracts stored and deflated files in nested folders and returns the paths', (t) => {
  const dest = tmp(t);
  const written = unzip(
    zipOf([
      { name: 'a/one.txt', data: 'one', method: 0 },
      { name: 'a/b/two.txt', data: 'two '.repeat(100), method: 8 },
    ]),
    dest,
  );
  assert.deepEqual(written, ['a/one.txt', 'a/b/two.txt']);
  assert.equal(readFileSync(path.join(dest, 'a/one.txt'), 'utf8'), 'one');
  assert.equal(readFileSync(path.join(dest, 'a/b/two.txt'), 'utf8'), 'two '.repeat(100));
});

test('unzip creates directory entries and handles an empty file', (t) => {
  const dest = tmp(t);
  const written = unzip(zipOf([{ name: 'empty-dir', dir: true }, { name: 'blank.txt' }, { name: 'stored.txt', method: 0 }]), dest);
  assert.ok(statSync(path.join(dest, 'empty-dir')).isDirectory());
  assert.deepEqual(written, ['blank.txt', 'stored.txt']);
  assert.equal(readFileSync(path.join(dest, 'blank.txt'), 'utf8'), '');
});

test('unzip skips __MACOSX entries and symlinks', (t) => {
  const dest = tmp(t);
  const written = unzip(
    zipOf([
      { name: 'ok.txt', data: 'x' },
      { name: '__MACOSX/._ok.txt', data: 'junk' },
      { name: 'link', data: '/etc/passwd', mode: 0o120777 },
    ]),
    dest,
  );
  assert.deepEqual(written, ['ok.txt']);
  assert.deepEqual(readdirSync(dest), ['ok.txt']);
});

test('unzip refuses paths that leave the folder and writes nothing outside', (t) => {
  for (const name of ['../evil.php', 'a/../../evil', '/abs.php', 'C:/x.php', '..\\evil', 'a\\..\\..\\evil', '\\abs.php']) {
    const parent = tmp(t);
    const dest = path.join(parent, 'dest');
    mkdirSync(dest);
    assert.throws(() => unzip(zipOf([{ name: 'good.txt', data: 'x' }, { name }]), dest), /absolute path|leaves the folder/, name);
    assert.deepEqual(readdirSync(parent), ['dest'], name);
    assert.deepEqual(readdirSync(dest), [], `${name}: nothing is written before every path is checked`);
  }
});

test('unzip refuses an encrypted entry', (t) => {
  assert.throws(() => unzip(zipOf([{ name: 'a.txt', data: 'x', flags: 1 }]), tmp(t)), /encrypted/);
});

test('unzip refuses a bad checksum', (t) => {
  assert.throws(() => unzip(zipOf([{ name: 'a.txt', data: 'hello', badCrc: true }]), tmp(t)), /checksum/);
});

test('unzip refuses a deflated entry that inflates past its declared size', (t) => {
  assert.throws(() => unzip(zipOf([{ name: 'bomb.txt', data: 'a'.repeat(100_000), size: 10 }]), tmp(t)), /does not unpack|checksum/);
});

test('unzip refuses archives over the limits', (t) => {
  const big = zipOf([{ name: 'a.txt', data: 'x'.repeat(2048) }]);
  assert.throws(() => unzip(big, tmp(t), { maxFiles: 10, maxBytes: 1024 }), /unpacks to more than/);
  const many = zipOf([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
  assert.throws(() => unzip(many, tmp(t), { maxFiles: 2, maxBytes: 1024 }), /holds 3 files/);
});

test('unzip refuses a buffer that is not a zip', (t) => {
  assert.throws(() => unzip(Buffer.from('this is plain text, definitely not a zip archive'), tmp(t)), /not a ZIP archive/);
});
