import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import './env.ts';
import { categorise, toFinding } from '../src/engines/wpcs.ts';
import { parseLint } from '../src/engines/php-lint.ts';
import { exec, NotFound } from '../src/exec.ts';
import { phpFiles, requiresPhp } from '../src/php/files.ts';
import { ignorePattern, parsePhpcs } from '../src/php/phpcs.ts';
import type { PhpcsMessage } from '../src/php/phpcs.ts';
import { progressLine } from '../src/progress.ts';
import { home } from '../src/home.ts';
import { tmp, write } from './helpers.ts';
import type { EngineRun } from '../src/types.ts';

const msg = (over: Partial<PhpcsMessage> = {}): PhpcsMessage => ({
  file: 'a.php', line: 3, column: 5, source: 'WordPress.Security.EscapeOutput.OutputNotEscaped', message: 'm', type: 'ERROR', fixable: false, ...over,
});

test('home follows WP_SHAKEDOWN_HOME', () => {
  assert.match(home(), /\.cache[\\/]wp-shakedown$/);
});

test('parsePhpcs reads the JSON report', () => {
  const json = JSON.stringify({
    totals: {},
    files: { 'a.php': { errors: 1, warnings: 0, messages: [{ message: 'Bad', source: 'X.Y.Z', type: 'WARNING', line: 4, column: 2, fixable: true, severity: 5 }] } },
  });
  assert.deepEqual(parsePhpcs(json), [{ file: 'a.php', line: 4, column: 2, source: 'X.Y.Z', message: 'Bad', type: 'WARNING', fixable: true }]);
  assert.throws(() => parsePhpcs('not json'), { message: 'PHPCS returned output that is not JSON.' });
  assert.throws(() => parsePhpcs('{}'), { message: 'PHPCS returned output that is not JSON.' });
});

test('categorise follows the rule list', () => {
  const cases: [string, string][] = [
    ['WordPress.PHP.YodaConditions.NotYoda', 'standards'],
    ['WordPress.Security.EscapeOutput.OutputNotEscaped', 'security'],
    ['WordPress.DB.PreparedSQL.NotPrepared', 'security'],
    ['WordPress.WP.I18n.MissingTranslatorsComment', 'i18n'],
    ['WordPress.DB.DirectDatabaseQuery.DirectQuery', 'performance'],
    ['WordPress.WP.EnqueuedResources.NonEnqueuedScript', 'correctness'],
    ['Generic.PHP.ForbiddenFunctions.Found', 'correctness'],
    ['Squiz.PHP.Eval.Discouraged', 'correctness'],
    ['Generic.CodeAnalysis.EmptyStatement.DetectedIf', 'correctness'],
    ['WordPress.WhiteSpace.PrecisionAlignment.Found', 'standards'],
  ];
  for (const [source, category] of cases) assert.equal(categorise(source), category, source);
});

test('toFinding maps severity and the fixable hint', () => {
  assert.equal(toFinding(msg({ source: 'Squiz.Commenting.FileComment.Missing', type: 'ERROR' })).severity, 'warning');
  assert.equal(toFinding(msg({ source: 'Squiz.Commenting.FileComment.Missing', type: 'WARNING' })).severity, 'info');
  assert.equal(toFinding(msg()).severity, 'error');
  assert.equal(toFinding(msg({ type: 'WARNING' })).severity, 'warning');
  assert.equal(toFinding(msg()).hint, undefined);
  const f = toFinding(msg({ fixable: true }));
  assert.equal(f.hint, 'phpcbf can fix this.');
  assert.deepEqual(f.location, { file: 'a.php', line: 3, column: 5 });
});

test('parseLint reads PHP parse errors', () => {
  const out = '\nParse error: syntax error, unexpected token "{", expecting variable in sample/inc/broken.php on line 2\nErrors parsing sample/inc/broken.php';
  assert.deepEqual(parseLint(out), { message: 'syntax error, unexpected token "{", expecting variable', line: 2 });
  assert.equal(parseLint('something else'), undefined);
});

test('phpFiles skips vendor, node_modules and dot folders', (t) => {
  const dir = tmp(t);
  for (const f of ['b.php', 'a.php', 'inc/c.php', 'vendor/x.php', 'node_modules/y.php', '.git/z.php', 'readme.txt']) write(path.join(dir, f));
  mkdirSync(path.join(dir, 'empty'));
  assert.deepEqual(phpFiles(dir).map((f) => path.relative(dir, f)), ['a.php', 'b.php', path.join('inc', 'c.php')]);
  assert.deepEqual(phpFiles(path.join(dir, 'a.php')), [path.join(dir, 'a.php')]);
});

test('requiresPhp reads style.css, plugin headers and readme.txt', (t) => {
  const theme = tmp(t);
  write(path.join(theme, 'style.css'), '/*\nTheme Name: T\nRequires PHP: 8.1\n*/');
  assert.equal(requiresPhp(theme), '8.1');
  const plugin = tmp(t);
  write(path.join(plugin, 'p.php'), '<?php\n/**\n * Plugin Name: P\n * Requires PHP: 7.4.1\n */');
  assert.equal(requiresPhp(plugin), '7.4');
  assert.equal(requiresPhp(path.join(plugin, 'p.php')), '7.4');
  const readme = tmp(t);
  write(path.join(readme, 'p.php'), '<?php\n');
  write(path.join(readme, 'readme.txt'), '=== P ===\nRequires PHP: 8.0\n');
  assert.equal(requiresPhp(readme), '8.0');
  const none = tmp(t);
  write(path.join(none, 'p.php'), '<?php\n');
  assert.equal(requiresPhp(none), undefined);
});

test('progressLine formats events', () => {
  const run = (over: Partial<EngineRun>): EngineRun => ({ engine: 'wpcs', status: 'ok', durationMs: 1250, findings: 2, ...over });
  assert.equal(progressLine({ type: 'engine:note', engine: 'wpcs', message: 'Hello.' }), '  wpcs: Hello.');
  assert.equal(progressLine({ type: 'engine:note', engine: 'wpcs', unit: 'theme:a', message: 'Hello.' }), '  wpcs theme:a: Hello.');
  assert.equal(progressLine({ type: 'engine:end', run: run({}) }), 'ok wpcs: 2 findings, 1.3s');
  assert.equal(progressLine({ type: 'engine:end', run: run({ findings: 1, unit: 'plugin:p' }) }), 'ok wpcs plugin:p: 1 finding, 1.3s');
  assert.equal(progressLine({ type: 'engine:end', run: run({ status: 'skipped', reason: 'No PHP.' }) }), 'skipped wpcs: No PHP.');
  assert.equal(progressLine({ type: 'engine:end', run: run({ status: 'failed', reason: 'Boom.' }) }), 'failed wpcs: Boom.');
  assert.equal(progressLine({ type: 'engine:start', engine: 'wpcs' }), undefined);
});

test('exec returns output and rejects with NotFound', async () => {
  const r = await exec(process.execPath, ['-e', 'console.log(1)']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '1');
  await assert.rejects(exec('wps-no-such-command-xyz', []), NotFound);
});

test('requiresPhp reads a version without a minor part as .0', (t) => {
  const dir = tmp(t);
  write(path.join(dir, 'style.css'), '/*\nTheme Name: T\nRequires PHP: 8\n*/\n');
  assert.equal(requiresPhp(dir), '8.0');
});

test('ignorePattern is anchored to the target and escapes it', () => {
  assert.equal(ignorePattern('/a/vendor/my.plugin (1)'), '^/a/vendor/my\\.plugin \\(1\\)/(.+/)?(vendor|node_modules)/');
  assert.equal(ignorePattern('/a,b'), '^/a\\,b/(.+/)?(vendor|node_modules)/');
});
