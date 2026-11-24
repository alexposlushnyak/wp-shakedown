import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { detectTarget, unitLabel } from '../src/target.ts';
import { makeInstall, makePlugin, makeTheme, tmp, write } from './helpers.ts';

test('detects a theme by its style.css header', (t) => {
  const dir = makeTheme(tmp(t), 'My Theme');
  const target = detectTarget(dir);
  assert.equal(target.kind, 'theme');
  assert.equal(target.name, 'My Theme');
  assert.equal(target.path, path.resolve(dir));
  assert.deepEqual(target.units, []);
});

test('detects a plugin by its header and takes the name from it', (t) => {
  const target = detectTarget(makePlugin(tmp(t), 'My Plugin'));
  assert.equal(target.kind, 'plugin');
  assert.equal(target.name, 'My Plugin');
});

test('detects an install and lists themes then plugins in order', (t) => {
  const dir = makeInstall(tmp(t));
  const target = detectTarget(dir);
  assert.equal(target.kind, 'install');
  assert.equal(target.name, path.basename(dir));
  assert.deepEqual(
    target.units.map((u) => [u.kind, u.name, path.relative(dir, u.path)]),
    [
      ['theme', 'Ay', path.join('wp-content', 'themes', 'a')],
      ['theme', 'Bee', path.join('wp-content', 'themes', 'b')],
      ['plugin', 'Folder Plugin', path.join('wp-content', 'plugins', 'folder-plugin')],
      ['plugin', 'Single', path.join('wp-content', 'plugins', 'single.php')],
    ],
  );
  assert.deepEqual(target.units.map((u) => unitLabel(u)), ['theme:a', 'theme:b', 'plugin:folder-plugin', 'plugin:single']);
});

test('treats a URL as a url target', () => {
  const target = detectTarget('https://example.com/shop');
  assert.deepEqual(target, { kind: 'url', path: 'https://example.com/shop', name: 'example.com', units: [] });
});

test('throws for something that is not a folder', (t) => {
  const file = write(path.join(tmp(t), 'f.txt'));
  assert.throws(() => detectTarget(file), { message: `"${file}" is not a folder.` });
  assert.throws(() => detectTarget('/no/such/folder'), { message: '"/no/such/folder" is not a folder.' });
});

test('throws for an unrecognised folder', (t) => {
  const dir = tmp(t);
  assert.throws(() => detectTarget(dir), /^Error: Cannot tell what ".*" is\. It has no wp-includes\/version\.php.*Pass --type theme, --type plugin or --type install\.$/);
});

test('--type skips sniffing and falls back to the folder name', (t) => {
  const dir = tmp(t);
  const target = detectTarget(dir, { type: 'theme' });
  assert.equal(target.kind, 'theme');
  assert.equal(target.name, path.basename(dir));
});

test('drops the comment end of a one-line header', (t) => {
  const dir = tmp(t);
  write(path.join(dir, 'style.css'), '/* Theme Name: One Line */\n');
  assert.equal(detectTarget(dir).name, 'One Line');
});
