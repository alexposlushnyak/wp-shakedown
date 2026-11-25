import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { root } from './env.ts';
import { phpCompat } from '../src/engines/php-compat.ts';
import { phpLint } from '../src/engines/php-lint.ts';
import { phpstan } from '../src/engines/phpstan.ts';
import { themeCheck } from '../src/engines/theme-check.ts';
import { wpcs } from '../src/engines/wpcs.ts';
import { exec } from '../src/exec.ts';
import { resetPhpCache } from '../src/php/php.ts';
import { resetToolsCache } from '../src/php/tools.ts';
import { resetPhpWasmCache } from '../src/php/wasm.ts';
import { run } from '../src/runner.ts';
import { detectTarget } from '../src/target.ts';
import type { Finding } from '../src/types.ts';
import { makeTheme, tmp, write } from './helpers.ts';

// Downloads about 160 MB the first time, so CI never runs it.
const enabled = process.env.WP_SHAKEDOWN_TEST_BUNDLED === '1';
const engines = [phpLint, wpcs, phpCompat, phpstan, themeCheck];

const key = (f: Finding): string => `${f.engine} ${f.rule} ${f.location.file ?? ''}:${f.location.line ?? ''}`;

test('the bundled PHP runs the PHP engines', { skip: enabled ? false : 'Set WP_SHAKEDOWN_TEST_BUNDLED=1 to download the bundled PHP and run this', timeout: 1800000 }, async (t) => {
  // Its own home, so a second run reuses the download.
  const home = path.join(root, '.cache', 'wp-shakedown-bundled');
  const hostHome = process.env.WP_SHAKEDOWN_HOME;
  const hostPhp = process.env.WP_SHAKEDOWN_PHP;
  t.after(() => {
    if (hostHome === undefined) delete process.env.WP_SHAKEDOWN_HOME;
    else process.env.WP_SHAKEDOWN_HOME = hostHome;
    if (hostPhp === undefined) delete process.env.WP_SHAKEDOWN_PHP;
    else process.env.WP_SHAKEDOWN_PHP = hostPhp;
  });

  const dir = makeTheme(tmp(t));
  write(path.join(dir, 'functions.php'), "<?php\nfunction fixture_show( $title ) {\n\techo $title;\n}\n");
  write(path.join(dir, 'inc', 'broken.php'), '<?php\nfunction broken( {\n');

  process.env.WP_SHAKEDOWN_HOME = home;
  process.env.WP_SHAKEDOWN_PHP = 'bundled';
  resetPhpCache();
  resetToolsCache();
  resetPhpWasmCache();
  const bundled = await run(detectTarget(dir), { engines, depth: 'deep' });
  assert.deepEqual(bundled.engines.map((e) => e.status), ['ok', 'ok', 'ok', 'ok', 'ok'], JSON.stringify(bundled.engines));

  const lint = bundled.findings.filter((f) => f.engine === 'php-lint');
  assert.equal(lint.length, 1);
  assert.equal(lint[0]!.location.file, 'inc/broken.php');
  assert.equal(lint[0]!.location.line, 2);
  const esc = bundled.findings.find((f) => f.engine === 'wpcs' && f.rule === 'WordPress.Security.EscapeOutput.OutputNotEscaped');
  assert.ok(esc, 'wpcs reports the unescaped echo');
  assert.equal(esc.location.file, 'functions.php');
  assert.equal(esc.location.line, 3);
  assert.ok(bundled.findings.some((f) => f.engine === 'theme-check'), 'theme-check reports something');
  assert.ok(bundled.findings.every((f) => f.location.file === undefined || !path.isAbsolute(f.location.file)), 'paths are relative to the theme');

  const host = await exec('php', ['-v']).then((r) => r.code === 0, () => false);
  const composer = await exec('composer', ['--version']).then((r) => r.code === 0, () => false);
  if (!host || !composer) return;
  process.env.WP_SHAKEDOWN_HOME = hostHome!;
  delete process.env.WP_SHAKEDOWN_PHP;
  resetPhpCache();
  resetToolsCache();
  const native = await run(detectTarget(dir), { engines, depth: 'deep' });
  assert.deepEqual(native.engines.map((e) => e.status), ['ok', 'ok', 'ok', 'ok', 'ok'], JSON.stringify(native.engines));
  // The bundled run leaves out Generic.PHP.Syntax, which php-lint covers.
  const keys = (r: { findings: Finding[] }): string[] => r.findings.filter((f) => f.rule !== 'Generic.PHP.Syntax.PHPSyntax').map(key).sort();
  assert.deepEqual(keys(bundled), keys(native));
});
