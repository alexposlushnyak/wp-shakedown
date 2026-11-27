import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import path from 'node:path';
import { customEngines, globToRegExp } from '../src/engines/custom.ts';
import { run } from '../src/runner.ts';
import { detectTarget } from '../src/target.ts';
import { makeTheme, tmp, write } from './helpers.ts';
import './env.ts';

/** A theme and a home with the given check files. The home variable is restored after the test. */
function setup(t: TestContext, checks: Record<string, unknown>, theme = makeTheme(tmp(t))) {
  const home = tmp(t);
  for (const [name, body] of Object.entries(checks)) {
    write(path.join(home, 'checks', `${name}.json`), typeof body === 'string' ? body : JSON.stringify(body));
  }
  const old = process.env.WP_SHAKEDOWN_HOME;
  process.env.WP_SHAKEDOWN_HOME = home;
  t.after(() => {
    if (old === undefined) delete process.env.WP_SHAKEDOWN_HOME;
    else process.env.WP_SHAKEDOWN_HOME = old;
  });
  const target = detectTarget(theme);
  return { theme, target, go: (level?: number) => run(target, { engines: customEngines(target), ...(level !== undefined ? { level } : {}) }) };
}

test('globs match POSIX paths', () => {
  assert.ok(globToRegExp('**/*.php').test('a.php'));
  assert.ok(globToRegExp('**/*.php').test('inc/a.php'));
  assert.ok(globToRegExp('*.zip').test('a.zip'));
  assert.ok(!globToRegExp('*.zip').test('x/a.zip'));
  assert.ok(globToRegExp('inc/**').test('inc/a/b.txt'));
  assert.ok(globToRegExp('*.{js,css}').test('a.css'));
  assert.ok(!globToRegExp('*.{js,css}').test('a.php'));
  assert.ok(!globToRegExp('a.php').test('abphp'));
  assert.ok(globToRegExp('a?.php').test('ab.php'));
});

test('no checks folder gives no engines, and the ID carries the name', (t) => {
  setup(t, {});
  assert.deepEqual(customEngines(), []);
  const s = setup(t, { 'no-todo': { type: 'files', forbid: ['*.zip'] }, 'Bad Name': {} });
  assert.deepEqual(customEngines(s.target).map((e) => e.id), ['custom:no-todo']);
});

test('a pattern check with forbid gives file and line', async (t) => {
  const s = setup(t, { todo: { type: 'pattern', files: '**/*.php', forbid: 'TODO', message: 'Remove the TODO.', severity: 'warning', hint: 'Finish it.' } });
  write(path.join(s.theme, 'inc', 'a.php'), '<?php\n// ok\n// TODO fix\n');
  write(path.join(s.theme, 'node_modules', 'x.php'), 'TODO');
  write(path.join(s.theme, '.git', 'x.php'), 'TODO');
  const r = await s.go();
  assert.equal(r.engines[0]!.engine, 'custom:todo');
  assert.deepEqual(r.findings.map((f) => [f.rule, f.severity, f.location.file, f.location.line, f.message, f.hint]), [
    ['todo', 'warning', 'inc/a.php', 3, 'Remove the TODO.', 'Finish it.'],
  ]);
});

test('a pattern check with require reports only when nothing matches', async (t) => {
  const check = { type: 'pattern', files: 'style.css', require: 'Theme Name', message: 'The header is missing.' };
  const none = await setup(t, { hdr: { ...check, require: 'Nope' } }).go();
  assert.deepEqual(none.findings.map((f) => [f.message, f.location]), [['The header is missing.', {}]]);
  const some = await setup(t, { hdr: check }).go();
  assert.equal(some.findings.length, 0);
});

test('a files check requires and forbids', async (t) => {
  const s = setup(t, { files: { type: 'files', require: ['readme.txt'], forbid: ['*.zip'] } });
  write(path.join(s.theme, 'a.zip'));
  const r = await s.go();
  assert.deepEqual(r.findings.map((f) => [f.message, f.location.file]).sort(), [
    ['Nothing matches "readme.txt".', undefined],
    ['This file must not be here.', 'a.zip'],
  ]);
});

test('a command check reports its exit code and output', { skip: process.platform === 'win32' && 'The commands use POSIX shell syntax' }, async (t) => {
  const bad = await setup(t, { cmd: { type: 'command', run: 'echo first; echo oops >&2; exit 3', title: 'Lint' } }).go();
  assert.equal(bad.findings.length, 1);
  assert.equal(bad.findings[0]!.message, 'Lint failed with exit code 3.');
  assert.equal(bad.findings[0]!.hint, 'first\noops');
  const good = await setup(t, { cmd: { type: 'command', run: 'exit 3', expectExit: 3 } }).go();
  assert.equal(good.findings.length, 0);
  assert.equal((await setup(t, { cmd: { type: 'command', run: 'exit 0' } }).go()).findings.length, 0);
});

test('onError decides what a check that cannot run does', async (t) => {
  const bad = { type: 'pattern', files: '*', forbid: '(', message: 'x' };
  const fail = await setup(t, { c: bad }).go();
  assert.equal(fail.engines[0]!.status, 'failed');
  assert.match(fail.engines[0]!.reason!, /^The pattern is not a valid regular expression/);
  const skip = await setup(t, { c: { ...bad, onError: 'skip' } }).go();
  assert.equal(skip.engines[0]!.status, 'skipped');
  const warn = await setup(t, { c: { ...bad, onError: 'warn' } }).go();
  assert.equal(warn.engines[0]!.status, 'ok');
  assert.equal(warn.findings[0]!.severity, 'warning');
  assert.match(warn.findings[0]!.message, /^The check could not run: /);
  const cmd = await setup(t, { c: { type: 'command', run: 'no-such-command-xyz' } }).go();
  assert.match(cmd.engines[0]!.reason!, /not found or could not run \(exit code 127\)/);
});

test('a check file that is not valid shows as a failed engine', async (t) => {
  const r = await setup(t, { broken: 'not json', odd: { type: 'files' }, extra: { type: 'files', forbid: ['a'], nope: 1 } }).go();
  const reason = (id: string) => r.engines.find((e) => e.engine === id)!.reason;
  assert.ok(r.engines.every((e) => e.status === 'failed'));
  assert.equal(reason('custom:broken'), 'The check file broken.json is not valid: it is not JSON.');
  assert.match(reason('custom:odd')!, /^The check file odd\.json is not valid: /);
  assert.match(reason('custom:extra')!, /^The check file extra\.json is not valid: it has a field the format does not know, "nope"\.$/);
});

test('paths, level and kinds decide whether a check runs', async (t) => {
  const s = setup(t, {
    here: { type: 'files', forbid: ['x'], paths: ['**/wps-*'] },
    away: { type: 'files', forbid: ['x'], paths: ['/nowhere/**'] },
    deep: { type: 'files', forbid: ['x'], depth: 'deep' },
    seven: { type: 'files', forbid: ['x'], level: 7 },
    install: { type: 'files', forbid: ['x'], kinds: ['install'] },
  });
  assert.deepEqual(customEngines(s.target).map((e) => e.id), ['custom:deep', 'custom:here', 'custom:install', 'custom:seven']);
  assert.equal(customEngines().length, 5);
  assert.deepEqual((await s.go()).engines.map((e) => e.engine), ['custom:here']);
  assert.deepEqual((await s.go(7)).engines.map((e) => e.engine), ['custom:here', 'custom:seven']);
  assert.deepEqual((await s.go(8)).engines.map((e) => e.engine), ['custom:deep', 'custom:here', 'custom:seven']);
});

// The shell starts sleep as its own process. A stop that reaches only the shell would leave the run waiting for sleep.
test('a command that runs past its timeout stops, with the commands it started', { skip: process.platform === 'win32' }, async (t) => {
  const started = Date.now();
  const r = await setup(t, { slow: { type: 'command', run: 'sleep 20 && echo done', timeoutSeconds: 0.3 } }).go();
  assert.ok(Date.now() - started < 5000, 'the run waited for the command');
  assert.equal(r.engines[0]!.status, 'failed');
  assert.match(r.engines[0]!.reason!, /did not finish in 0\.3 seconds/);
});

test('a stopped run stops a running command', { skip: process.platform === 'win32' }, async (t) => {
  const { target } = setup(t, { slow: { type: 'command', run: 'sleep 20 && echo done' } });
  const ctl = new AbortController();
  const started = Date.now();
  setTimeout(() => ctl.abort(), 200);
  const r = await run(target, { engines: customEngines(target), signal: ctl.signal });
  assert.ok(Date.now() - started < 5000, 'the run waited for the command');
  assert.equal(r.engines[0]!.status, 'failed');
});
