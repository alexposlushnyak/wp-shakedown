import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { exec } from '../src/exec.ts';
import { VERSION } from '../src/version.ts';
import { root, testHome } from './env.ts';
import { makeSample, makeTheme, tmp, write, zipOf } from './helpers.ts';

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

test('add takes a ZIP file and lists the theme under Themes', (t) => {
  const home = tmp(t);
  const zip = path.join(tmp(t), 'gamma-1.2.zip');
  writeFileSync(zip, zipOf([{ name: 'gamma/style.css', data: '/*\nTheme Name: Gamma\n*/\n' }, { name: 'gamma/index.php', data: '<?php\n' }]));
  assert.match(cliHome(home, 'add', zip).stdout, /Added the theme "Gamma"\./);
  assert.ok(existsSync(path.join(home, 'uploads', 'themes', 'gamma', 'style.css')));
  assert.match(cliHome(home, 'list').stdout, /\nThemes\n\S+\s+Gamma /);
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
  assert.match(first.stdout, /0 critical, 0 important, 0 recommended\./);
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

test('--preset checks its input, and --profile is the old name', (t) => {
  const theme = makeTheme(tmp(t));
  const unknown = cli('run', theme, '--preset', 'nope');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown preset "nope"/);
  assert.match(cli('run', theme, '--profile', 'nope').stderr, /Unknown preset "nope"/);
  const both = cli('run', theme, '--preset', 'wporg-theme', '--engine', 'php-lint');
  assert.equal(both.status, 2);
  assert.match(both.stderr, /Use a preset or a list of engines, not both\./);
  const help = cli('--help').stdout;
  assert.match(help, /--preset <id> .*wporg-theme, envato, wporg-plugin, client or site/);
  assert.doesNotMatch(help, /--profile|--depth/);
  assert.match(help, /wp-shakedown presets/);
});

// A real run: the preset picks the engines, so no fake engine is needed. It needs PHP for php-lint and the tools for the rest.
test('--preset runs only the engines of that preset', { timeout: 180000, ...(hasPhp ? {} : { skip: 'PHP and Composer are needed' }) }, (t) => {
  const theme = makeTheme(tmp(t));
  const out = path.join(tmp(t), 'out');
  const r = cli('run', theme, '--preset', 'wporg-theme', '--out', out, '--fail-on', 'never');
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')) as { preset: string; level: number; engines: { engine: string }[] };
  assert.equal(report.preset, 'wporg-theme');
  assert.equal(report.level, 7);
  const allowed = ['php-lint', 'theme-check', 'review', 'wpcs', 'php-compat', 'wp-json'];
  assert.ok(report.engines.length > 0 && report.engines.every((e) => allowed.includes(e.engine)));
});

test('--level checks its input, and --depth is the old name', () => {
  for (const flag of ['--level', '--depth']) {
    for (const bad of ['nope', '11', '-1', '2.5']) {
      // A value that starts with a dash only parses in the form --level=-1.
      const r = bad.startsWith('-') ? cli('run', '.', `${flag}=${bad}`) : cli('run', '.', flag, bad);
      assert.equal(r.status, 2, `${flag} ${bad}`);
      assert.match(r.stderr, /Level must be a number from 0 to 10, or quick, standard or deep\./);
    }
  }
  assert.match(cli('--help').stdout, /--level <n> {9}How thorough the run is, from 0 to 10\. The default is 6\. quick, standard and deep work as 3, 6 and 8/);
});

test('--fail-on takes the severity names and the old ones', (t) => {
  const theme = makeTheme(tmp(t));
  for (const v of ['critical', 'important', 'recommended', 'never', 'error', 'warning', 'info']) {
    const r = cli('run', theme, '--type', 'install', '--engine', 'config', '--out', path.join(tmp(t), 'out'), '--fail-on', v);
    assert.equal(r.status, 0, `${v}: ${r.stderr}`);
  }
  const bad = cli('run', theme, '--fail-on', 'fatal');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--fail-on must be critical, important, recommended or never\./);
  assert.match(cli('--help').stdout, /--fail-on <name> .*critical, important, recommended or never/);
});

test('the presets command lists the built-in presets and the user presets, with problems after them', (t) => {
  const home = tmp(t);
  write(path.join(home, 'presets', 'mine.json'), JSON.stringify({ schema: 1, title: 'Mine', summary: 'S', kinds: ['plugin'], engines: ['php-lint'], level: 4 }));
  write(path.join(home, 'presets', 'broken.json'), '{');
  const r = cliHome(home, 'presets');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ID +Title +Kinds +Level +Engines +Source$/m);
  assert.match(r.stdout, /^client +Client or commercial project .* built-in$/m);
  assert.match(r.stdout, /^mine +Mine +plugin +4 +1 +.*mine\.json$/m);
  assert.match(r.stdout, /broken\.json is not a valid preset: it is not JSON\./);
});

// The exit code and the level come from the preset unless a flag says otherwise.
test('a preset sets the level and the exit threshold unless the flags are given', (t) => {
  const home = tmp(t);
  const theme = makeTheme(tmp(t));
  // style.css has no Template header and no screenshot. The config engine does not fit a theme, so use a custom check that always finds one thing.
  write(path.join(home, 'checks', 'always.json'), JSON.stringify({ type: 'files', require: ['no-such-file.txt'], message: 'Missing file.', severity: 'warning', level: 2 }));
  write(path.join(home, 'presets', 'strict.json'), JSON.stringify({ schema: 1, title: 'Strict', summary: 'S', kinds: ['theme'], engines: ['custom:always'], level: 9, failOn: 'warning' }));
  const run = (...flags: string[]) => {
    const out = path.join(tmp(t), 'out');
    const r = cliHome(home, 'run', theme, '--preset', 'strict', '--out', out, ...flags);
    return { status: r.status, level: (JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')) as { level: number }).level };
  };
  assert.deepEqual(run(), { status: 1, level: 9 });
  assert.deepEqual(run('--fail-on', 'critical'), { status: 0, level: 9 });
  assert.deepEqual(run('--fail-on', 'recommended'), { status: 1, level: 9 });
  assert.deepEqual(run('--level', '4'), { status: 1, level: 4 });
  assert.deepEqual(run('--depth', 'quick'), { status: 1, level: 3 });
});

test('--experimental is an old name: level 7 or more with the wordpress.org rules', (t) => {
  const theme = makeTheme(tmp(t));
  const report = (...flags: string[]) => {
    const out = path.join(tmp(t), 'out');
    cli('run', theme, '--engine', 'php-lint', '--out', out, '--fail-on', 'never', ...flags);
    return JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')) as { level: number; directory?: string };
  };
  assert.deepEqual([report().level, report().directory], [6, undefined]);
  assert.deepEqual([report('--experimental').level, report('--experimental').directory], [7, 'wporg']);
  assert.equal(report('--experimental', '--level', '9').level, 9);
  assert.match(cli('--help').stdout, /--experimental is an old name: level 7 or more, with the wordpress.org rules/);
});

test('history lists the runs and prints one', (t) => {
  const home = tmp(t);
  const theme = makeTheme(tmp(t), 'Alpha');
  assert.match(cliHome(home, 'history', theme).stdout, /No runs yet for "Alpha"\. Run wp-shakedown run <path> first\./);
  for (let i = 0; i < 2; i++) assert.equal(cliHome(home, 'run', theme, '--engine', 'php-lint', '--fail-on', 'never').status, 0);
  const table = cliHome(home, 'history', theme);
  assert.equal(table.status, 0);
  const lines = table.stdout.trim().split('\n');
  assert.match(lines[0]!, /^#\s+Run\s+Critical\s+Important\s+Recommended\s+Level\s+Preset/);
  assert.equal(lines.length, 3);
  const one = cliHome(home, 'history', theme, '1');
  assert.equal(one.status, 0);
  assert.match(one.stdout, /since the run of \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  assert.equal(cliHome(home, 'history', theme, '2', '--full').status, 0);
  const missing = cliHome(home, 'history', theme, '9');
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /No run "9"\. wp-shakedown history .* lists them\./);
});
