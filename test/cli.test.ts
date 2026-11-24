import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { exec } from '../src/exec.ts';
import { VERSION } from '../src/version.ts';
import { root, testHome } from './env.ts';
import { makeSample, makeTheme, tmp } from './helpers.ts';

const cli = (...args: string[]) =>
  spawnSync(process.execPath, ['src/cli.ts', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, WP_SHAKEDOWN_HOME: testHome } });

test('--version and --help', () => {
  assert.equal(cli('--version').stdout.trim(), VERSION);
  assert.match(cli('--help').stdout, /Usage:/);
  assert.match(cli('--help').stdout, /wp-shakedown mcp/);
  assert.match(cli().stdout, /Usage:/);
});

test('run writes the four reports and shows the diff on the second run', (t) => {
  const theme = tmp(t);
  const out = path.join(tmp(t), 'out');
  const first = cli('run', theme, '--type', 'install', '--out', out);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /0 errors, 0 warnings, 0 notes\./);
  assert.match(first.stdout, /Report: /);
  for (const f of ['md', 'json', 'sarif', 'html']) assert.ok(existsSync(path.join(out, `report.${f}`)));
  assert.doesNotMatch(first.stdout, /still open/);
  const second = cli('run', theme, '--type', 'install', '--out', out);
  assert.match(second.stdout, /0 fixed, 0 new, 0 still open\./);
});

test('failures exit 2 with a message', (t) => {
  const missing = cli('run', '/no/such/folder');
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /is not a folder/);
  const noPath = cli('run');
  assert.equal(noPath.status, 2);
  assert.match(noPath.stderr, /Give a folder to test/);
  const theme = makeTheme(tmp(t));
  assert.equal(cli('run', theme, '--fail-on', 'nope').status, 2);
  assert.equal(cli('run', theme, '--type', 'nope').status, 2);
  assert.equal(cli('bogus').status, 2);
  const inside = cli('run', theme, '--out', path.join(theme, 'out'));
  assert.equal(inside.status, 2);
  assert.match(inside.stderr, /inside the target/);
});

const hasPhp = await Promise.all([exec('php', ['-v']), exec('composer', ['--version'])]).then(
  (r) => r.every((x) => x.code === 0),
  () => false,
);

test('run on a plugin shows progress on stderr', { timeout: 180000, ...(hasPhp ? {} : { skip: 'PHP and Composer are needed' }) }, (t) => {
  const plugin = makeSample(tmp(t));
  const r = cli('run', plugin, '--out', path.join(tmp(t), 'out'));
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^ok wpcs:/m);
  assert.match(r.stdout, /Report:/);
});
