import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import './env.ts';
import { siteHealth, toFindings } from '../src/engines/site-health.ts';
import { run } from '../src/runner.ts';
import { detectTarget } from '../src/target.ts';
import { makeInstall, tmp, write } from './helpers.ts';

test('toFindings keeps what Site Health flags', () => {
  const found = toFindings([
    { test: 'php_extensions', status: 'good', label: 'Required modules are installed' },
    { test: 'plugin_version', status: 'recommended', label: 'You should remove inactive plugins', description: '<p>Your site has 1 inactive plugin.&nbsp;Remove it.</p>' },
    { test: 'autoloaded_options', status: 'critical', label: 'Autoloaded options could affect performance', description: '' },
  ]);
  assert.deepEqual(
    found.map((f) => [f.rule, f.severity, f.category, f.message, f.hint]),
    [
      ['plugin_version', 'info', 'health', 'You should remove inactive plugins', 'Your site has 1 inactive plugin. Remove it.'],
      ['autoloaded_options', 'warning', 'health', 'Autoloaded options could affect performance', undefined],
    ],
  );
  assert.ok(found.every((f) => f.docs?.startsWith('https://wordpress.org/') && Object.keys(f.location).length === 0));
});

/** Points the engine at a stand-in for WP-CLI that prints the given output and exits with the given code. */
function fakeWp(t: TestContext, stdout: string, stderr = '', code = 0): void {
  const file = path.join(tmp(t), 'wp');
  write(file, `#!/bin/sh\ncat <<'OUT'\n${stdout}\nOUT\ncat >&2 <<'ERR'\n${stderr}\nERR\nexit ${code}\n`);
  chmodSync(file, 0o755);
  const old = process.env.WP_SHAKEDOWN_WP;
  process.env.WP_SHAKEDOWN_WP = file;
  t.after(() => {
    if (old === undefined) delete process.env.WP_SHAKEDOWN_WP;
    else process.env.WP_SHAKEDOWN_WP = old;
  });
}

const unix = { skip: process.platform === 'win32' ? 'The stand-in for WP-CLI is a shell script' : false };

test('site-health reads the JSON after anything printed before it', unix, async (t) => {
  const json = JSON.stringify({ wordpress: '6.8', tests: [{ test: 'theme_version', status: 'recommended', label: 'You should remove inactive themes' }, { test: 'sql_server', status: 'error', label: 'boom' }] });
  fakeWp(t, `PHP Notice: something\n${json}`);
  const notes: string[] = [];
  const found = await siteHealth.run({ target: detectTarget(makeInstall(tmp(t))), level: 6, note: (m) => notes.push(m) });
  assert.deepEqual(found.map((f) => f.rule), ['theme_version']);
  assert.deepEqual(notes, ['The Site Health test sql_server could not run: boom']);
});

test('site-health is skipped when the database does not answer or WordPress has no config', unix, async (t) => {
  const target = detectTarget(makeInstall(tmp(t)));
  fakeWp(t, '', 'Error: Error establishing a database connection.', 1);
  const nodb = await run(target, { engines: [siteHealth] });
  assert.equal(nodb.engines[0]!.status, 'skipped');
  assert.match(nodb.engines[0]!.reason!, /could not reach its database/);
  fakeWp(t, '', "Error: 'wp-config.php' not found.", 1);
  assert.match((await run(target, { engines: [siteHealth] })).engines[0]!.reason!, /no wp-config\.php/);
  fakeWp(t, '', 'Error: This does not seem to be a WordPress installation.', 1);
  assert.equal((await run(target, { engines: [siteHealth] })).engines[0]!.status, 'skipped');
  fakeWp(t, '', 'Error: Something else broke.', 1);
  const broken = await run(target, { engines: [siteHealth] });
  assert.equal(broken.engines[0]!.status, 'failed');
  assert.equal(broken.engines[0]!.reason, 'WP-CLI stopped: Something else broke.');
});

test('site-health is skipped without WP-CLI', async (t) => {
  const old = process.env.WP_SHAKEDOWN_WP;
  process.env.WP_SHAKEDOWN_WP = path.join(tmp(t), 'no-such-wp');
  t.after(() => {
    if (old === undefined) delete process.env.WP_SHAKEDOWN_WP;
    else process.env.WP_SHAKEDOWN_WP = old;
  });
  const r = await run(detectTarget(makeInstall(tmp(t))), { engines: [siteHealth] });
  assert.equal(r.engines[0]!.status, 'skipped');
  assert.match(r.engines[0]!.reason!, /^WP-CLI is not installed/);
});
