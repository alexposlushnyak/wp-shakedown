import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { exec } from '../src/exec.ts';
import { VERSION } from '../src/version.ts';
import { root, testHome } from './env.ts';
import { makeSample, makeTheme, tmp } from './helpers.ts';

const cli = (...args: string[]) =>
  spawnSync(process.execPath, ['src/cli.ts', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, WP_SHAKEDOWN_HOME: testHome } });

const cliHome = (home: string, ...args: string[]) =>
  spawnSync(process.execPath, ['src/cli.ts', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, WP_SHAKEDOWN_HOME: home } });

test('--version and --help', () => {
  assert.equal(cli('--version').stdout.trim(), VERSION);
  assert.match(cli('--help').stdout, /Usage:/);
  assert.match(cli('--help').stdout, /wp-shakedown mcp/);
  assert.match(cli().stdout, /Usage:/);
  for (const text of ['wp-shakedown add <path>...', 'wp-shakedown remove <project>...', 'wp-shakedown list', 'run --all', '--jobs <n>']) {
    assert.ok(cli('--help').stdout.includes(text), text);
  }
});

test('add, list and remove', (t) => {
  const home = tmp(t);
  const theme = makeTheme(tmp(t), 'Alpha');
  assert.match(cliHome(home, 'list').stdout, /No projects yet\. Add one with: wp-shakedown add <path>/);
  assert.match(cliHome(home, 'add', theme).stdout, /Added the theme "Alpha"\./);
  assert.match(cliHome(home, 'add', theme).stdout, /"Alpha" is already on the list\./);
  const listed = cliHome(home, 'list');
  assert.match(listed.stdout, /Alpha .*never/);
  const bad = cliHome(home, 'add', '/no/such/folder');
  assert.equal(bad.status, 2);
  assert.equal(cliHome(home, 'add').status, 2);
  assert.match(cliHome(home, 'remove', 'alpha').stdout, /Removed "alpha"\. Its reports stay\./);
  const gone = cliHome(home, 'remove', 'alpha');
  assert.equal(gone.status, 2);
  assert.match(gone.stderr, /No project fits "alpha"/);
  assert.equal(cliHome(home, 'remove').status, 2);
});

test('run with several targets checks its input', (t) => {
  const home = tmp(t);
  const a = makeTheme(tmp(t), 'Alpha');
  const b = makeTheme(tmp(t), 'Beta');
  const noneYet = cliHome(home, 'run', '--all');
  assert.equal(noneYet.status, 2);
  assert.match(noneYet.stderr, /No projects yet/);
  assert.equal(cliHome(home, 'run', a, '--jobs', '0').status, 2);
  assert.match(cliHome(home, 'run', a, '--jobs', 'x').stderr, /--jobs must be a number from 1 to 8\./);
  assert.match(cliHome(home, 'run', a, b, '--out', 'x').stderr, /--out works with one path\./);
  assert.match(cliHome(home, 'run', a, b, '--baseline', 'x').stderr, /--baseline works with one path\./);
  assert.match(cliHome(home, 'run', a, '--all').stderr, /Use --all or paths, not both\./);
});

test('run --all runs every project on the list', (t) => {
  const home = tmp(t);
  cliHome(home, 'add', makeTheme(tmp(t), 'Alpha'), makeTheme(tmp(t), 'Beta'));
  const r = cliHome(home, 'run', '--all', '--engine', 'wp-json', '--fail-on', 'never');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^Alpha: .* Report: /);
  assert.match(lines[1]!, /^Beta: .* Report: /);
  assert.match(r.stderr, /^\[Alpha\] ok wp-json/m);
  assert.match(cliHome(home, 'list').stdout, /Alpha .*\d{4}-\d\d-\d\d \d\d:\d\d/);
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

test('--profile checks its input', (t) => {
  const theme = makeTheme(tmp(t));
  const unknown = cli('run', theme, '--profile', 'nope');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown profile "nope"/);
  const both = cli('run', theme, '--profile', 'wporg-theme', '--engine', 'php-lint');
  assert.equal(both.status, 2);
  assert.match(both.stderr, /Use a profile or a list of engines, not both\./);
  assert.match(cli('--help').stdout, /--profile <id> .*wporg-theme, envato, wporg-plugin or site/);
});

// A real run: the profile picks the engines, so no fake engine is needed. It needs PHP for php-lint and the tools for the rest.
test('--profile runs only the engines of that profile', { timeout: 180000, ...(hasPhp ? {} : { skip: 'PHP and Composer are needed' }) }, (t) => {
  const theme = makeTheme(tmp(t));
  const out = path.join(tmp(t), 'out');
  const r = cli('run', theme, '--profile', 'wporg-theme', '--out', out, '--fail-on', 'never');
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')) as { profile: string; engines: { engine: string }[] };
  assert.equal(report.profile, 'wporg-theme');
  const allowed = ['php-lint', 'theme-check', 'wpcs', 'php-compat', 'wp-json'];
  assert.ok(report.engines.length > 0 && report.engines.every((e) => allowed.includes(e.engine)));
});

test('--depth checks its input', () => {
  const bad = cli('run', '.', '--depth', 'nope');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--depth must be quick, standard or deep\./);
  assert.match(cli('--help').stdout, /--depth <level> {5}How thorough the run is: quick, standard or deep\. The default is standard/);
});

test('--help lists --experimental', () => {
  assert.match(cli('--help').stdout, /--experimental {6}Also run the experimental engines/);
});
