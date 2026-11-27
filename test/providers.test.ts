import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import path from 'node:path';
import { ask } from '../src/assistant/providers.ts';
import { detectTarget } from '../src/target.ts';
import { FAIL_ANSWER, fakeBin, tasks } from './assistant-helpers.ts';
import './env.ts';
import { makeTheme, tmp } from './helpers.ts';

/** Puts `bin` alone on PATH next to the folder of node, so the fakes are found and a real claude never is. */
function onPath(t: TestContext, bin: string): void {
  const old = process.env.PATH;
  process.env.PATH = bin;
  t.after(() => {
    process.env.PATH = old;
  });
}

const fakeClaude = `
const args = process.argv.slice(2);
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const at = args.indexOf('--tools');
  const sources = args.indexOf('--setting-sources');
  if (at < 0 || args[at + 1] !== 'Read,Grep,Glob' || sources < 0 || args[sources + 1] !== 'user' || !args.includes('-p') || input.length === 0) {
    console.log(JSON.stringify({ is_error: true, result: 'bad arguments: ' + args.join(' ') }));
    process.exit(1);
  }
  console.log(JSON.stringify({ structured_output: ${FAIL_ANSWER} }));
});
`;

const fakeCodex = `
const args = process.argv.slice(2);
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const at = args.indexOf('--output-last-message');
  if (at < 0 || !args.includes('read-only') || args.at(-1) !== '-') process.exit(1);
  require('node:fs').writeFileSync(args[at + 1], 'Here it is: ' + ${JSON.stringify(FAIL_ANSWER)});
});
`;

test('claude: passes the tool list and reads structured_output', async (t) => {
  const bin = tmp(t);
  fakeBin(bin, 'claude', fakeClaude);
  const dir = makeTheme(tmp(t));
  onPath(t, `${bin}${path.delimiter}${path.dirname(process.execPath)}`);
  const a = await ask('claude', tasks[0]!, detectTarget(dir));
  assert.equal(a.check, 'one');
  assert.equal(a.verdict, 'fail');
  assert.deepEqual(a.findings, [{ file: 'a.php', line: 3, severity: 'error', message: 'm' }]);
});

test('claude: a failing process becomes an unsure answer with the error', async (t) => {
  const bin = tmp(t);
  fakeBin(bin, 'claude', `console.error('nope'); process.exit(3);`);
  onPath(t, `${bin}${path.delimiter}${path.dirname(process.execPath)}`);
  const a = await ask('claude', tasks[0]!, detectTarget(makeTheme(tmp(t))));
  assert.equal(a.verdict, 'unsure');
  assert.deepEqual(a.findings, []);
  assert.match(a.error!, /nope/);
});

test('codex: reads the last message file', async (t) => {
  const bin = tmp(t);
  fakeBin(bin, 'codex', fakeCodex);
  onPath(t, `${bin}${path.delimiter}${path.dirname(process.execPath)}`);
  const a = await ask('codex', tasks[1]!, detectTarget(makeTheme(tmp(t))));
  assert.equal(a.check, 'two');
  assert.equal(a.verdict, 'fail');
});

test('a missing command gives the install message', async (t) => {
  onPath(t, tmp(t));
  const target = detectTarget(makeTheme(tmp(t)));
  assert.equal((await ask('claude', tasks[0]!, target)).error, 'Claude Code is not installed. Install it, or set another assistant in the preset.');
  assert.equal((await ask('codex', tasks[0]!, target)).error, 'Codex is not installed. Install it, or set another assistant in the preset.');
});

test('api: without a key it names how to set one and calls nothing', async (t) => {
  const old = { home: process.env.WP_SHAKEDOWN_HOME, key: process.env.ANTHROPIC_API_KEY };
  process.env.WP_SHAKEDOWN_HOME = tmp(t);
  delete process.env.ANTHROPIC_API_KEY;
  t.after(() => {
    process.env.WP_SHAKEDOWN_HOME = old.home;
    if (old.key !== undefined) process.env.ANTHROPIC_API_KEY = old.key;
  });
  const a = await ask('api', tasks[0]!, detectTarget(makeTheme(tmp(t))));
  assert.equal(a.verdict, 'unsure');
  assert.equal(a.error, 'No Anthropic API key. Run wp-shakedown key set anthropic, or set ANTHROPIC_API_KEY.');
});
