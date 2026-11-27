import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import './env.ts';
import { parseLintBatch } from '../src/engines/php-lint.ts';
import { parsePhpstan, phpstanJson } from '../src/engines/phpstan.ts';
import { MISSING_PHP, phpBinary, usesBundledPhp } from '../src/php/php.ts';
import { COMPOSER_VERSION, composerPhar, standardPaths } from '../src/php/tools.ts';
import { fakeNet } from './helpers.ts';

const saved = process.env.WP_SHAKEDOWN_PHP;
afterEach(() => {
  if (saved === undefined) delete process.env.WP_SHAKEDOWN_PHP;
  else process.env.WP_SHAKEDOWN_PHP = saved;
});

test('usesBundledPhp is true only for the value bundled', () => {
  process.env.WP_SHAKEDOWN_PHP = 'bundled';
  assert.equal(usesBundledPhp(), true);
  process.env.WP_SHAKEDOWN_PHP = '/usr/bin/php';
  assert.equal(usesBundledPhp(), false);
  assert.equal(phpBinary(), '/usr/bin/php');
  delete process.env.WP_SHAKEDOWN_PHP;
  assert.equal(usesBundledPhp(), false);
});

test('the missing PHP message names all three ways out', () => {
  assert.equal(
    MISSING_PHP,
    'PHP is not installed. Put php on your PATH, set WP_SHAKEDOWN_PHP to its path, or set WP_SHAKEDOWN_PHP=bundled to use a PHP that wp-shakedown downloads once (about 160 MB).',
  );
});

test('parseLintBatch maps each parse error to its file, also with spaces in the path', () => {
  const files = ['/t/my theme/ok.php', '/t/my theme/bad.php', '/t/other.php'];
  const out = [
    'No syntax errors detected in /t/my theme/ok.php',
    '',
    'Parse error: syntax error, unexpected token "{" in /t/my theme/bad.php on line 2',
    'Errors parsing /t/my theme/bad.php',
    'Errors parsing /t/other.php',
  ].join('\n');
  const r = parseLintBatch(out, files);
  assert.deepEqual([...r.keys()], ['/t/my theme/bad.php', '/t/other.php']);
  assert.deepEqual(r.get('/t/my theme/bad.php'), { message: 'syntax error, unexpected token "{"', line: 2 });
  assert.equal(r.get('/t/other.php'), undefined);
});

test('phpstanJson skips the file paths that --debug prints first', () => {
  const report = JSON.stringify({ totals: { errors: 0, file_errors: 1 }, files: { '/b/a.php': { messages: [{ message: 'Bad', line: 3, identifier: 'x.y' }] } }, errors: [] });
  const json = phpstanJson(`/b/a.php\n/b/c.php\n${report}\n`);
  assert.ok(json);
  const f = parsePhpstan(json, '/b');
  assert.equal(f.length, 1);
  assert.equal(f[0]!.location.file, 'a.php');
  assert.equal(phpstanJson('Fatal error: nothing\n'), undefined);
});

test('standardPaths resolves the standards from installed.json', () => {
  const json = JSON.stringify({
    packages: [
      { name: 'a/lib', type: 'library', 'install-path': '../a/lib' },
      { name: 'wp/wpcs', type: 'phpcodesniffer-standard', 'install-path': '../wp/wpcs' },
      { name: 'x/compat', type: 'phpcodesniffer-standard', 'install-path': '../x/compat' },
    ],
  });
  assert.deepEqual(standardPaths(json, '/t/vendor/composer'), [path.resolve('/t/vendor/wp/wpcs'), path.resolve('/t/vendor/x/compat')]);
});

test('composerPhar refuses a download with the wrong checksum and leaves no file', async (t) => {
  const url = `https://getcomposer.org/download/${COMPOSER_VERSION}/composer.phar`;
  fakeNet(t, new Map([[url, { status: 200, body: 'not composer' }]]));
  await assert.rejects(composerPhar(), /The download of Composer did not match its checksum\./);
  const dir = path.join(process.env.WP_SHAKEDOWN_HOME!, 'tools');
  assert.equal(existsSync(path.join(dir, `composer-${COMPOSER_VERSION}.phar`)), false);
  assert.deepEqual(existsSync(dir) ? (await import('node:fs')).readdirSync(dir) : [], []);
});
