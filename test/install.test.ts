import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import './env.ts';
import { coreVersion, packages } from '../src/health/install.ts';
import { detectTarget } from '../src/target.ts';
import { makeInstall, tmp, write } from './helpers.ts';

test('coreVersion reads version and locale', (t) => {
  const dir = tmp(t);
  write(path.join(dir, 'wp-includes', 'version.php'), "<?php\n$wp_version = '6.8.1';\n$wp_local_package = 'de_DE';\n");
  assert.deepEqual(coreVersion(dir), { version: '6.8.1', locale: 'de_DE' });
  write(path.join(dir, 'wp-includes', 'version.php'), "<?php\n$wp_version = '6.8';\n");
  assert.deepEqual(coreVersion(dir), { version: '6.8', locale: 'en_US' });
  assert.equal(coreVersion(tmp(t)), undefined);
});

test('packages lists themes and plugins with versions', (t) => {
  const dir = makeInstall(tmp(t));
  const p = packages(detectTarget(dir));
  const by = (slug: string) => p.find((x) => x.slug === slug)!;
  assert.deepEqual(by('a'), { kind: 'theme', slug: 'a', name: 'Ay', version: '1.0', path: path.join(dir, 'wp-content/themes/a'), file: 'wp-content/themes/a/style.css' });
  assert.equal(by('folder-plugin').version, '2.1.0');
  assert.equal(by('folder-plugin').file, 'wp-content/plugins/folder-plugin/main.php');
  assert.equal(by('single').version, '0.5');
  assert.equal(by('single').file, 'wp-content/plugins/single.php');
});
