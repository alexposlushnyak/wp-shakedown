import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.ts';
import { makeTheme, tmp } from './helpers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = (...args: string[]) => spawnSync(process.execPath, ['src/cli.ts', ...args], { cwd: root, encoding: 'utf8' });

test('--version and --help', () => {
  assert.equal(cli('--version').stdout.trim(), VERSION);
  assert.match(cli('--help').stdout, /Usage:/);
  assert.match(cli().stdout, /Usage:/);
});

test('run writes the four reports and shows the diff on the second run', (t) => {
  const theme = makeTheme(tmp(t));
  const out = path.join(tmp(t), 'out');
  const first = cli('run', theme, '--out', out);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /No engine ran/);
  assert.match(first.stdout, /Report: /);
  for (const f of ['md', 'json', 'sarif', 'html']) assert.ok(existsSync(path.join(out, `report.${f}`)));
  assert.doesNotMatch(first.stdout, /still open/);
  const second = cli('run', theme, '--out', out);
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
