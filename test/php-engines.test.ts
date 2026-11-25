import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import './env.ts';
import { phpCompat } from '../src/engines/php-compat.ts';
import { phpLint } from '../src/engines/php-lint.ts';
import { themeCheck } from '../src/engines/theme-check.ts';
import { phpstan } from '../src/engines/phpstan.ts';
import { wpJson } from '../src/engines/wp-json.ts';
import { wpcs } from '../src/engines/wpcs.ts';
import { exec } from '../src/exec.ts';
import { resetPhpCache } from '../src/php/php.ts';
import { resetToolsCache } from '../src/php/tools.ts';
import { run } from '../src/runner.ts';
import { detectTarget } from '../src/target.ts';
import type { RunEvent } from '../src/types.ts';
import { makeSample, makeTheme, tmp, write } from './helpers.ts';

const available = await Promise.all([exec('php', ['-v']), exec('composer', ['--version'])]).then(
  (r) => r.every((x) => x.code === 0),
  () => false,
);
// Generous, because the PHP tools run several times slower on a busy machine.
const opts = { timeout: 600000, ...(available ? {} : { skip: 'PHP and Composer are needed' }) };

const engines = [phpLint, wpcs, phpCompat, phpstan, wpJson];

describe('php engines', opts, () => {
  test('lint, wpcs and compat report the sample plugin', opts, async (t) => {
    const dir = makeSample(tmp(t));
    const r = await run(detectTarget(dir), { engines, depth: 'deep' });
    assert.deepEqual(r.engines.map((e) => e.status), ['ok', 'ok', 'ok', 'ok', 'ok'], JSON.stringify(r.engines));

    const lint = r.findings.filter((f) => f.engine === 'php-lint');
    assert.equal(lint.length, 1);
    assert.equal(lint[0]!.location.file, 'inc/broken.php');
    assert.equal(lint[0]!.location.line, 2);
    assert.equal(lint[0]!.rule, 'syntax');

    const wp = r.findings.filter((f) => f.engine === 'wpcs');
    const esc = wp.find((f) => f.rule === 'WordPress.Security.EscapeOutput.OutputNotEscaped');
    assert.ok(esc);
    assert.equal(esc.severity, 'error');
    assert.equal(esc.category, 'security');
    assert.equal(esc.location.file, 'sample.php');
    assert.equal(esc.location.line, 8);
    const standards = wp.filter((f) => f.category === 'standards');
    assert.ok(standards.length > 0);
    assert.ok(standards.every((f) => f.severity !== 'error'));

    const compat = r.findings.find((f) => f.engine === 'php-compat' && f.rule.startsWith('PHPCompatibility.') && f.message.includes('match'));
    assert.ok(compat);
    assert.equal(compat.severity, 'error');
    assert.equal(compat.category, 'compatibility');

    const short = wp.find((f) => f.rule === 'PluginCheck.CodeAnalysis.ShortURL.Found');
    assert.ok(short);
    assert.equal(short.category, 'correctness');
  });

  // The sample has a file with a syntax error. PHPStan alone would report that and nothing else.
  test('phpstan reports the sample plugin and leaves out the file that does not parse', async (t) => {
    const dir = makeSample(tmp(t));
    const events: RunEvent[] = [];
    const r = await run(detectTarget(dir), { engines: [phpstan], depth: 'deep', onEvent: (e) => events.push(e) });
    assert.ok(events.some((e) => e.type === 'engine:note' && e.message === 'Left out 1 file that PHP cannot parse. php-lint reports them.'));
    assert.ok(!r.findings.some((f) => f.rule === 'phpstan.parse'));
    assert.equal(r.engines[0]!.status, 'ok', r.engines[0]!.reason);
    const stan = r.findings;
    const nf = stan.find((f) => f.rule === 'function.notFound');
    assert.ok(nf && nf.message.includes('undefined_function_call'));
    assert.ok(stan.some((f) => f.rule === 'arguments.count'));
    assert.ok(stan.every((f) => f.severity === 'warning' && f.location.file === 'sample.php'), JSON.stringify(stan));
  });

  test('wpcs skips the plugin review rules for a theme', async (t) => {
    const dir = makeTheme(tmp(t));
    write(path.join(dir, 'functions.php'), "<?php\nfunction sample_more() {\n\t$u = 'https://bit.ly/abc';\n\treturn $u;\n}\n");
    const r = await run(detectTarget(dir), { engines: [wpcs] });
    assert.equal(r.engines[0]!.status, 'ok', r.engines[0]!.reason);
    assert.ok(!r.findings.some((f) => f.rule.startsWith('PluginCheck.')));
  });

  test('wp-json reports schema and syntax problems in a theme', async (t) => {
    const dir = makeTheme(tmp(t));
    write(path.join(dir, 'theme.json'), '{"$schema":"https://schemas.wp.org/trunk/theme.json","version":3,"settings":{"notARealSetting":true}}');
    write(path.join(dir, 'styles', 'broken.json'), '{ "version": 3, }');
    const r = await run(detectTarget(dir), { engines: [wpJson] });
    const st = r.engines[0]!.status;
    assert.ok(st === 'ok' || st === 'skipped', r.engines[0]!.reason);
    if (st !== 'ok') return;
    // The WordPress schema flags unknown names through propertyNames, older drafts through additionalProperties.
    const extra = r.findings.find((f) => /^schema\.(additionalProperties|propertyNames)$/.test(f.rule));
    assert.ok(extra && extra.message.includes('notARealSetting'), JSON.stringify(r.findings));
    assert.equal(r.findings.find((f) => f.rule === 'json.syntax')?.severity, 'error');
  });

  test('a missing PHP skips every engine', async (t) => {
    const dir = makeSample(tmp(t));
    const before = process.env.WP_SHAKEDOWN_PHP;
    process.env.WP_SHAKEDOWN_PHP = path.join(dir, 'no-such-php');
    resetPhpCache();
    resetToolsCache();
    try {
      const r = await run(detectTarget(dir), { engines, depth: 'deep' });
      assert.deepEqual(r.engines.filter((e) => e.engine !== 'wp-json').map((e) => e.status), ['skipped', 'skipped', 'skipped', 'skipped']);
      for (const e of r.engines.filter((x) => x.engine !== 'wp-json')) assert.ok(e.reason?.startsWith('PHP is not installed.'), e.reason);
    } finally {
      if (before === undefined) delete process.env.WP_SHAKEDOWN_PHP;
      else process.env.WP_SHAKEDOWN_PHP = before;
      resetPhpCache();
      resetToolsCache();
    }
  });

  test('wpcs uses a project ruleset', async (t) => {
    const dir = makeSample(tmp(t));
    write(path.join(dir, 'phpcs.xml.dist'), '<?xml version="1.0"?><ruleset name="x"><rule ref="WordPress.Security.EscapeOutput"/></ruleset>');
    const events: RunEvent[] = [];
    const r = await run(detectTarget(dir), { engines: [wpcs], onEvent: (e) => events.push(e) });
    assert.equal(r.engines[0]!.status, 'ok', r.engines[0]!.reason);
    assert.ok(r.findings.length > 0);
    assert.ok(r.findings.every((f) => f.rule.startsWith('WordPress.Security.EscapeOutput')));
    assert.ok(events.some((e) => e.type === 'engine:note' && e.message === 'Using the project ruleset phpcs.xml.dist.'));
  });
  test('theme check reports eval and a missing readme, and a missing parent theme', opts, async (t) => {
    const dir = tmp(t);
    write(path.join(dir, 'style.css'), '/*\nTheme Name: Bad\nVersion: 1.0\n*/\n');
    write(path.join(dir, 'index.php'), '<?php\n');
    write(path.join(dir, 'functions.php'), '<?php\neval( $x );\n');
    const r = await run(detectTarget(dir), { engines: [themeCheck] });
    assert.equal(r.engines[0]!.status, 'ok', r.engines[0]!.reason);
    const bad = r.findings.find((f) => f.rule === 'bad-things');
    assert.ok(bad);
    assert.equal(bad.severity, 'error');
    assert.equal(bad.location.file, 'functions.php');
    assert.equal(bad.location.line, 2);
    assert.ok(r.findings.some((f) => f.rule === 'file'));

    const child = tmp(t);
    write(path.join(child, 'style.css'), '/*\nTheme Name: Kid\nTemplate: nowhere\nVersion: 1.0\n*/\n');
    write(path.join(child, 'index.php'), '<?php\n');
    const notes: string[] = [];
    await themeCheck.run({ target: detectTarget(child), note: (m) => notes.push(m) });
    assert.ok(notes.some((n) => n.includes('nowhere')), JSON.stringify(notes));
  });

  test('under the envato profile theme check runs the Envato fork', opts, async (t) => {
    const dir = tmp(t);
    write(path.join(dir, 'style.css'), '/*\nTheme Name: Bad\nVersion: 1.0\n*/\n');
    write(path.join(dir, 'index.php'), '<?php\n');
    write(path.join(dir, 'functions.php'), '<?php\nmkdir( "x" );\n');
    const target = detectTarget(dir);
    const envato = await run(target, { engines: [themeCheck], only: ['theme-check'], profile: 'envato' });
    assert.equal(envato.engines[0]!.status, 'ok', envato.engines[0]!.reason);
    assert.equal(envato.engines[0]!.variant, 'envato');
    const own = envato.findings.find((f) => f.rule === 'themeforest');
    assert.ok(own, 'no finding of the Envato check');
    assert.deepEqual([own.severity, own.location.file, own.location.line], ['error', 'functions.php', 2]);
    assert.match(own.message, /mkdir\(\) is not allowed/);
    const plain = await run(target, { engines: [themeCheck] });
    assert.ok(!('variant' in plain.engines[0]!));
    assert.ok(!plain.findings.some((f) => f.rule === 'themeforest'));
  });
});
