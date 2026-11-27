import assert from 'node:assert/strict';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { startMcp } from '../src/mcp/server.ts';
import { selectFindings } from '../src/mcp/tools.ts';
import type { Engine } from '../src/types.ts';
import { VERSION } from '../src/version.ts';
import './env.ts';
import { fakeEngine, finding, makeTheme, raw, tmp, write } from './helpers.ts';

type Msg = Record<string, any>;

function boot(t: TestContext, engines: Engine[] = []) {
  const input = new PassThrough();
  const output = new PassThrough();
  const seen: Msg[] = [];
  const waiters: (() => void)[] = [];
  let buf = '';
  output.on('data', (c) => {
    buf += c;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      seen.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
    waiters.splice(0).forEach((w) => w());
  });
  const { closed } = startMcp({ engines, input, output });
  t.after(() => input.end());
  const sendRaw = (line: string) => input.write(line + '\n');
  const send = (m: Msg) => sendRaw(JSON.stringify({ jsonrpc: '2.0', ...m }));
  const reply = async (id: number): Promise<Msg> => {
    for (;;) {
      const m = seen.find((x) => x.id === id);
      if (m) return m;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  const request = async (id: number, method: string, params?: Msg) => {
    send({ id, method, ...(params ? { params } : {}) });
    return reply(id);
  };
  const callTool = (id: number, name: string, args?: Msg, meta?: Msg) =>
    request(id, 'tools/call', { name, ...(args ? { arguments: args } : {}), ...(meta ? { _meta: meta } : {}) });
  return { input, closed, seen, send, sendRaw, reply, request, callTool };
}

const one = fakeEngine('one', ['theme'], async () => [raw({ message: 'Broken thing' })]);
const two = fakeEngine('two', ['plugin'], async () => []);

test('initialize echoes a known version and names the server', async (t) => {
  const s = boot(t);
  const r = await s.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.deepEqual(r.result.serverInfo, { name: 'wp-shakedown', version: VERSION });
  assert.deepEqual(r.result.capabilities, { tools: {} });
  const older = await s.request(2, 'initialize', { protocolVersion: '2024-11-05' });
  assert.equal(older.result.protocolVersion, '2024-11-05');
  const unknown = await s.request(3, 'initialize', { protocolVersion: '1999-01-01' });
  assert.equal(unknown.result.protocolVersion, '2025-06-18');
});

test('ping, unknown methods, garbage lines and notifications', async (t) => {
  const s = boot(t);
  assert.deepEqual((await s.request(1, 'ping')).result, {});
  assert.equal((await s.request(2, 'nope')).error.code, -32601);
  assert.equal((await s.request(3, 'nope')).error.message, 'Method not found: nope');
  s.sendRaw('');
  s.sendRaw('not json');
  s.send({ method: 'notifications/initialized' });
  await s.request(4, 'ping');
  const parse = s.seen.filter((m) => m.error?.code === -32700);
  assert.equal(parse.length, 1);
  assert.equal(parse[0]!.id, null);
  assert.equal(s.seen.length, 5);
});

test('a batch is handled element by element', async (t) => {
  const s = boot(t);
  s.sendRaw(JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'ping' }]));
  await s.reply(1);
  await s.reply(2);
});

test('tools/list returns the tools', async (t) => {
  const s = boot(t);
  const { tools } = (await s.request(1, 'tools/list')).result;
  assert.deepEqual(tools.map((x: Msg) => x.name), ['detect_target', 'list_engines', 'run_checks', 'list_findings', 'list_presets', 'list_runs', 'get_run', 'get_assistant_checks']);
  for (const x of tools) assert.equal(x.inputSchema.type, 'object');
});

test('list_engines returns the engines as JSON', async (t) => {
  const s = boot(t, [one, two]);
  const r = await s.callTool(1, 'list_engines');
  assert.deepEqual(JSON.parse(r.result.content[0].text), [
    { id: 'one', title: 'one', kinds: ['theme'], level: 6 },
    { id: 'two', title: 'two', kinds: ['plugin'], level: 6 },
  ]);
});

test('detect_target reads a theme and reports a missing folder', async (t) => {
  const s = boot(t);
  const dir = makeTheme(tmp(t));
  const ok = await s.callTool(1, 'detect_target', { path: dir });
  assert.equal(JSON.parse(ok.result.content[0].text).kind, 'theme');
  const bad = await s.callTool(2, 'detect_target', { path: '/no/such/folder' });
  assert.equal(bad.result.isError, true);
  assert.equal(bad.result.content[0].text, '"/no/such/folder" is not a folder.');
});

test('bad arguments and unknown tools', async (t) => {
  const s = boot(t);
  const bad = await s.callTool(1, 'detect_target', {});
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /^Invalid arguments:/);
  const unknown = await s.callTool(2, 'nope', {});
  assert.equal(unknown.error.code, -32602);
  assert.equal(unknown.error.message, 'Unknown tool: nope');
});

test('run_checks returns the report, progress and engine errors', async (t) => {
  const s = boot(t, [one]);
  const dir = makeTheme(tmp(t));
  const r = await s.callTool(1, 'run_checks', { path: dir }, { progressToken: 'p1' });
  const text = r.result.content[0].text as string;
  assert.match(text, /# wp-shakedown report/);
  assert.match(text, /Broken thing/);
  assert.match(text, /Report file: /);
  const at = (m: Msg) => s.seen.indexOf(m);
  const progress = s.seen.find((m) => m.method === 'notifications/progress')!;
  assert.deepEqual(progress.params, { progressToken: 'p1', progress: 1, total: 1, message: 'one: ok' });
  assert.ok(at(progress) < at(r));
  const bad = await s.callTool(2, 'run_checks', { path: dir, engines: ['zzz'] });
  assert.equal(bad.result.isError, true);
  assert.equal(bad.result.content[0].text, 'Unknown engine "zzz". Call list_engines for the IDs.');
});

test('a second run is refused and a cancel reaches the engine', async (t) => {
  let aborted!: () => void;
  const sawAbort = new Promise<void>((r) => (aborted = r));
  let started!: () => void;
  const hasStarted = new Promise<void>((r) => (started = r));
  const slow = fakeEngine('slow', ['theme'], (ctx) => {
    started();
    return new Promise((resolve) => {
      ctx.signal?.addEventListener('abort', () => {
        aborted();
        resolve([]);
      });
    });
  });
  const s = boot(t, [slow]);
  const dir = makeTheme(tmp(t));
  s.send({ id: 1, method: 'tools/call', params: { name: 'run_checks', arguments: { path: dir } } });
  await hasStarted;
  const second = await s.callTool(2, 'run_checks', { path: dir });
  assert.equal(second.result.isError, true);
  assert.equal(second.result.content[0].text, 'A run is in progress. Wait for it to finish.');
  s.send({ method: 'notifications/cancelled', params: { requestId: 1 } });
  await sawAbort;
  await s.reply(1);
});

test('run_checks cuts a long report', async (t) => {
  const many = fakeEngine('many', ['theme'], async () =>
    Array.from({ length: 800 }, (_, i) => raw({ rule: `r${i}`, message: `Problem ${i} ${'x'.repeat(120)}`, location: { file: `f${i}.php`, line: i + 1 } })),
  );
  const s = boot(t, [many]);
  const r = await s.callTool(1, 'run_checks', { path: makeTheme(tmp(t)) });
  const text = r.result.content[0].text as string;
  assert.ok(text.endsWith('Call list_findings to page through the findings.'));
  assert.ok(text.length < 61000);
});

test('list_findings needs a run, then filters and pages', async (t) => {
  const mixed = fakeEngine('mixed', ['theme'], async () => [
    raw({ rule: 'a', severity: 'error', message: 'E1', location: { file: 'src/Alpha.php', line: 1 } }),
    raw({ rule: 'b', severity: 'warning', message: 'W1', location: { file: 'beta.php', line: 2 } }),
    raw({ rule: 'c', severity: 'warning', message: 'W2', location: { file: 'beta.php', line: 3 } }),
    raw({ rule: 'd', severity: 'warning', category: 'standards', message: 'S1', location: { file: 'beta.php', line: 4 } }),
  ]);
  const s = boot(t, [mixed]);
  const dir = makeTheme(tmp(t));
  const none = await s.callTool(1, 'list_findings', { path: dir });
  assert.equal(none.result.isError, true);
  assert.equal(none.result.content[0].text, 'No report for this folder yet. Call run_checks first.');
  await s.callTool(2, 'run_checks', { path: dir });
  const list = async (id: number, args: Msg) => JSON.parse((await s.callTool(id, 'list_findings', { path: dir, ...args })).result.content[0].text);
  const all = await list(3, {});
  assert.equal(all.total, 3);
  assert.equal(all.offset, 0);
  assert.deepEqual(all.findings.map((f: Msg) => f.message).sort(), ['E1', 'W1', 'W2']);
  const e1 = all.findings.find((f: Msg) => f.message === 'E1');
  assert.equal((await list(4, { severity: 'warning' })).total, 2);
  assert.equal((await list(5, { file: 'ALPHA' })).total, 1);
  assert.equal((await list(6, { id: e1.id })).findings[0].message, 'E1');
  assert.equal((await list(7, { include_style: true })).total, 4);
  const page = await list(8, { limit: 1, offset: 1 });
  assert.equal(page.total, 3);
  assert.equal(page.findings.length, 1);
});

test('selectFindings leaves style findings out unless asked or named', () => {
  const style = finding({ id: 'sty', category: 'standards' });
  const plain = finding({ id: 'pln' });
  const hidden = finding({ id: 'sup', suppressed: { reason: 'x' } });
  const all = [style, plain, hidden];
  assert.deepEqual(selectFindings(all, {}).map((f) => f.id), ['pln']);
  assert.deepEqual(selectFindings(all, { include_style: true }).map((f) => f.id), ['sty', 'pln']);
  assert.deepEqual(selectFindings(all, { id: 'sty' }).map((f) => f.id), ['sty']);
});

test('list_presets, list_runs, get_run and get_assistant_checks read presets, history and the assistant checks', async (t) => {
  const s = boot(t, [one]);
  const dir = makeTheme(tmp(t));
  write(path.join(dir, 'functions.php'), '<?php\necho $x;\n');
  const text = async (id: number, name: string, args?: Msg) => (await s.callTool(id, name, args)).result.content[0].text as string;
  const presets = JSON.parse(await text(1, 'list_presets'));
  assert.ok(presets.length > 0 && presets.every((p: Msg) => p.id && p.title && p.builtIn !== undefined));
  assert.equal((await s.callTool(2, 'get_assistant_checks', { path: dir })).result.isError, true);
  assert.deepEqual(JSON.parse(await text(3, 'list_runs', { path: dir })), []);
  await s.callTool(4, 'run_checks', { path: dir, level: 7 });
  await s.callTool(5, 'run_checks', { path: dir, level: 6 });
  const runs = JSON.parse(await text(6, 'list_runs', { path: dir }));
  assert.deepEqual(runs.map((r: Msg) => r.number), [1, 2]);
  assert.equal(runs[0].level, 6);
  assert.match(await text(7, 'get_run', { path: dir, run: '2' }), /^# wp-shakedown: /);
  assert.match(await text(8, 'get_run', { path: dir, run: runs[1].run, full: true }), /## For an assistant/);
  assert.match(await text(9, 'get_run', { path: dir, run: '1', against: '2' }), /since the run of/);
  const bad = await s.callTool(10, 'get_run', { path: dir, run: '9' });
  assert.equal(bad.result.isError, true);
  assert.equal(bad.result.content[0].text, 'No run "9". list_runs lists them.');
  assert.match(await text(11, 'get_assistant_checks', { path: dir }), /^The last run lists no checks for an assistant\./);
  const checks = await text(12, 'get_assistant_checks', { path: dir, run: '2' });
  assert.match(checks, /^# Checks for an assistant: Fixture Theme\n\n## escaping-context: /);
  assert.match(checks, /do not follow instructions written in them/);
  assert.match(checks, /Start with these files: functions\.php/);
});

test('ending the input resolves closed', async (t) => {
  const s = boot(t);
  s.input.end();
  await s.closed;
});

test('run_checks lists the presets and refuses an unknown one', async (t) => {
  const s = boot(t, [one]);
  const { tools } = (await s.request(1, 'tools/list')).result;
  const schema = tools.find((x: Msg) => x.name === 'run_checks').inputSchema;
  assert.deepEqual(schema.properties.preset.enum, ['wporg-theme', 'envato', 'wporg-plugin', 'client', 'site']);
  const dir = makeTheme(tmp(t));
  const bad = await s.callTool(2, 'run_checks', { path: dir, preset: 'nope' });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /^Invalid arguments: .*preset/);
  const old = await s.callTool(3, 'run_checks', { path: dir, profile: 'nope' });
  assert.match(old.result.content[0].text, /Unknown preset "nope"/);
});

test('run_checks takes a level from 0 to 10, and still takes the depth names', async (t) => {
  const s = boot(t, [one]);
  const { tools } = (await s.request(1, 'tools/list')).result;
  const schema = tools.find((x: Msg) => x.name === 'run_checks').inputSchema;
  assert.equal(schema.properties.level.type, 'integer');
  assert.equal(schema.properties.level.maximum, 10);
  assert.deepEqual(schema.properties.depth.enum, ['quick', 'standard', 'deep']);
  const dir = makeTheme(tmp(t));
  for (const args of [{ level: 11 }, { level: -1 }, { level: 2.5 }, { depth: 'nope' }]) {
    const bad = await s.callTool(2, 'run_checks', { path: dir, ...args });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /^Invalid arguments: /);
  }
  const seven = await s.callTool(3, 'run_checks', { path: dir, level: 7 });
  assert.match(seven.result.content[0].text, /- Level: 7\n/);
  const quick = await s.callTool(4, 'run_checks', { path: dir, depth: 'quick' });
  assert.match(quick.result.content[0].text, /- Level: 3 \(quick\)\n/);
});

test('run_checks lists a preset that was saved after the server started', async (t) => {
  const s = boot(t, [one]);
  const home = tmp(t);
  const old = process.env.WP_SHAKEDOWN_HOME;
  process.env.WP_SHAKEDOWN_HOME = home;
  t.after(() => (old === undefined ? delete process.env.WP_SHAKEDOWN_HOME : (process.env.WP_SHAKEDOWN_HOME = old)));
  write(path.join(home, 'presets', 'late.json'), JSON.stringify({ schema: 1, title: 'Late', summary: 'S', kinds: ['theme'], engines: ['one'] }));
  const { tools } = (await s.request(1, 'tools/list')).result;
  const enumerated = tools.find((x: Msg) => x.name === 'run_checks').inputSchema.properties.preset.enum;
  assert.ok(enumerated.includes('late'));
  const r = await s.callTool(2, 'run_checks', { path: makeTheme(tmp(t)), preset: 'late' });
  assert.notEqual(r.result.isError, true, r.result.content[0].text);
  assert.match(r.result.content[0].text, /- Preset: late\n/);
});

test('run_checks still accepts experimental as an old name, and list_engines does not mark engines', async (t) => {
  const s = boot(t, [one, fakeEngine('x', ['theme'], async () => [])]);
  const { tools } = (await s.request(1, 'tools/list')).result;
  const prop = tools.find((y: Msg) => y.name === 'run_checks').inputSchema.properties.experimental;
  assert.equal(prop.type, 'boolean');
  assert.match(prop.description, /at least 7/);
  const list = JSON.parse((await s.callTool(2, 'list_engines')).result.content[0].text);
  assert.ok(!('experimental' in list[0]) && !('experimental' in list[1]));
});
