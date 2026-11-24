import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import './env.ts';
import { phpCompat } from '../src/engines/php-compat.ts';
import { phpLint } from '../src/engines/php-lint.ts';
import { wpcs } from '../src/engines/wpcs.ts';
import { exec } from '../src/exec.ts';
import { resetPhpCache } from '../src/php/php.ts';
import { resetToolsCache } from '../src/php/tools.ts';
import { run } from '../src/runner.ts';
import { detectTarget } from '../src/target.ts';
import type { RunEvent } from '../src/types.ts';
import { makeSample, tmp, write } from './helpers.ts';

const available = await Promise.all([exec('php', ['-v']), exec('composer', ['--version'])]).then(
  (r) => r.every((x) => x.code === 0),
  () => false,
);
const opts = { timeout: 180000, ...(available ? {} : { skip: 'PHP and Composer are needed' }) };

const engines = [phpLint, wpcs, phpCompat];

describe('php engines', opts, () => {
  test('lint, wpcs and compat report the sample plugin', opts, async (t) => {
    const dir = makeSample(tmp(t));
    const r = await run(detectTarget(dir), { engines });
    assert.deepEqual(r.engines.map((e) => e.status), ['ok', 'ok', 'ok'], JSON.stringify(r.engines));

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
  });

  test('a missing PHP skips every engine', async (t) => {
    const dir = makeSample(tmp(t));
    const before = process.env.WP_SHAKEDOWN_PHP;
    process.env.WP_SHAKEDOWN_PHP = path.join(dir, 'no-such-php');
    resetPhpCache();
    resetToolsCache();
    try {
      const r = await run(detectTarget(dir), { engines });
      assert.deepEqual(r.engines.map((e) => e.status), ['skipped', 'skipped', 'skipped']);
      for (const e of r.engines) assert.ok(e.reason?.startsWith('PHP is not installed.'), e.reason);
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
});
