import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { runSession } from '../src/session.ts';
import { startUi } from '../src/ui/server.ts';
import type { Engine } from '../src/types.ts';
import { root, testHome } from './env.ts';
import { fakeEngine, makeTheme, raw, tmp, write } from './helpers.ts';

const found = fakeEngine('found', ['theme'], async () => [raw()]);

async function boot(t: TestContext, engines: Engine[] = [found]) {
  const startDir = tmp(t);
  const ui = await startUi({ engines, startDir, port: 0 });
  t.after(() => ui.close());
  const base = `http://127.0.0.1:${ui.port}`;
  const api = (p: string, init: RequestInit = {}) =>
    fetch(base + p, { ...init, headers: { 'x-shakedown-token': ui.token, ...init.headers } });
  const post = (p: string, body: unknown) =>
    api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ui, base, api, post, startDir };
}

/** Reads SSE frames from a fetch response. */
function frames(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return async (): Promise<{ event: string; data: any }> => {
    for (;;) {
      const i = buf.indexOf('\n\n');
      if (i >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(raw)?.[1];
        const data = /^data: (.*)$/m.exec(raw)?.[1];
        if (event && data) return { event, data: JSON.parse(data) };
        continue;
      }
      const { value, done } = await reader.read();
      assert.ok(!done, 'the stream ended early');
      buf += dec.decode(value);
    }
  };
}

test('the token guards /api', async (t) => {
  const { base, ui } = await boot(t);
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  assert.equal((await fetch(`${base}/api/state`, { headers: { 'x-shakedown-token': 'wrong' } })).status, 401);
  const ok = await fetch(`${base}/api/state`, { headers: { 'x-shakedown-token': ui.token } });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { engines: { id: string }[]; running: boolean };
  assert.deepEqual(body.engines.map((e) => e.id), ['found']);
  assert.equal(body.running, false);
  const state = (await (await fetch(`${base}/api/state`, { headers: { 'x-shakedown-token': ui.token } })).json()) as { profiles: { id: string }[] };
  assert.equal(state.profiles.length, 3);
  assert.equal((await fetch(`${base}/api/state?t=${ui.token}`)).status, 200);
});

test('static routes answer without crashing', async (t) => {
  const { base } = await boot(t);
  const missing = await fetch(`${base}/nope`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Not found.' });
  const index = await fetch(`${base}/index.html`);
  assert.ok([200, 404].includes(index.status));
  await index.arrayBuffer();
  assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
});

test('a wrong Host or Origin is refused', async (t) => {
  const { ui } = await boot(t);
  const req = (headers: http.OutgoingHttpHeaders) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      http
        .request({ host: '127.0.0.1', port: ui.port, path: `/api/state?t=${ui.token}`, headers }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode!, body }));
        })
        .on('error', reject)
        .end();
    });
  const host = await req({ host: 'evil.example' });
  assert.equal(host.status, 403);
  assert.deepEqual(JSON.parse(host.body), { error: 'Bad host.' });
  const origin = await req({ origin: 'http://evil.example' });
  assert.equal(origin.status, 403);
  assert.deepEqual(JSON.parse(origin.body), { error: 'Bad origin.' });
});

test('/api/dirs lists sorted subfolders without dot folders', async (t) => {
  const { api, startDir } = await boot(t);
  for (const d of ['beta', 'Alpha', '.hidden']) write(path.join(startDir, d, 'x'));
  write(path.join(startDir, 'file.txt'));
  const res = await api('/api/dirs');
  const body = (await res.json()) as { path: string; parent: string | null; dirs: { name: string }[] };
  assert.equal(body.path, startDir);
  assert.equal(body.parent, path.dirname(startDir));
  assert.deepEqual(body.dirs.map((d) => d.name), ['Alpha', 'beta']);
  assert.equal((await api(`/api/dirs?path=${encodeURIComponent(path.join(startDir, 'file.txt'))}`)).status, 400);
  const rel = await api('/api/dirs?path=relative');
  assert.equal(rel.status, 400);
  assert.deepEqual(await rel.json(), { error: 'Give an absolute path.' });
});

test('/api/detect names a theme and rejects an empty folder', async (t) => {
  const { api } = await boot(t);
  const theme = makeTheme(tmp(t));
  const ok = await api(`/api/detect?path=${encodeURIComponent(theme)}`);
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { kind: string; name: string; units: unknown[] };
  assert.deepEqual([body.kind, body.name, body.units], ['theme', 'Fixture Theme', []]);
  const bad = await api(`/api/detect?path=${encodeURIComponent(tmp(t))}`);
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /^Cannot tell what/);
});

test('POST /api/run checks its input', async (t) => {
  const { api, post } = await boot(t);
  const plain = await api('/api/run', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(plain.status, 415);
  const empty = await post('/api/run', {});
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: 'Send a path.' });
  const theme = makeTheme(tmp(t));
  const unknown = await post('/api/run', { path: theme, engines: ['nope'] });
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { error: 'Unknown engine "nope".' });
  const profile = await post('/api/run', { path: theme, profile: 'nope' });
  assert.equal(profile.status, 400);
  assert.deepEqual(await profile.json(), { error: 'Unknown profile "nope".' });
  const both = await post('/api/run', { path: theme, profile: 'wporg-theme', engines: ['found'] });
  assert.equal(both.status, 400);
  const big = await post('/api/run', { path: 'x'.repeat(70000) });
  assert.equal(big.status, 413);
});

test('a full run streams events and keeps the report', async (t) => {
  const { api, post } = await boot(t);
  assert.equal((await api('/api/report')).status, 404);
  const stream = await api('/api/events');
  assert.match(stream.headers.get('content-type') ?? '', /^text\/event-stream/);
  const next = frames(stream);
  const first = await next();
  assert.equal(first.event, 'snapshot');
  assert.deepEqual(first.data, { running: false, events: [] });

  const theme = makeTheme(tmp(t));
  assert.equal((await post('/api/run', { path: theme })).status, 202);
  const got = [];
  for (let i = 0; i < 4; i++) got.push(await next());
  assert.ok(got.every((f) => f.event === 'run'));
  assert.deepEqual(got.map((f) => f.data.type), ['run:start', 'engine:start', 'engine:end', 'run:end']);
  assert.deepEqual(got[0]!.data.jobs, [{ engine: 'found' }]);
  assert.equal(got[0]!.data.target.units, 0);
  assert.equal(got[3]!.data.summary.error, 1);
  assert.equal('result' in got[3]!.data, false);

  // The report is stored after run:end, so allow a moment.
  let report: Response;
  for (let i = 0; (report = await api('/api/report')).status === 404 && i < 50; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(report.status, 200);
  const body = (await report.json()) as { result: { findings: unknown[] }; files: string[] };
  assert.equal(body.result.findings.length, 1);
  assert.equal(body.files.length, 4);
});

test('a second run is refused and cancel stops the first', async (t) => {
  const slow = fakeEngine('slow', ['theme'], (ctx) =>
    new Promise((_, reject) => ctx.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
  );
  const { api, post } = await boot(t, [slow]);
  const next = frames(await api('/api/events'));
  await next();
  const theme = makeTheme(tmp(t));
  assert.equal((await post('/api/run', { path: theme })).status, 202);
  assert.equal(((await next()).data as { type: string }).type, 'run:start');
  assert.equal((await next()).data.type, 'engine:start');
  const again = await post('/api/run', { path: theme });
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: 'A run is in progress.' });
  assert.equal((await api('/api/cancel', { method: 'POST' })).status, 200);
  assert.equal((await next()).data.type, 'engine:end');
  assert.deepEqual((await next()).data, { type: 'run:error', message: 'The run was stopped.' });
});

test('an engine that throws is a failed engine, not a run error', async (t) => {
  const bad = fakeEngine('bad', ['theme'], async () => {
    throw new Error('boom');
  });
  const { api, post } = await boot(t, [bad]);
  const next = frames(await api('/api/events'));
  await next();
  await post('/api/run', { path: makeTheme(tmp(t)) });
  const types = [];
  for (let i = 0; i < 4; i++) types.push((await next()).data);
  assert.deepEqual(types.map((e) => e.type), ['run:start', 'engine:start', 'engine:end', 'run:end']);
  assert.equal(types[2]!.run.status, 'failed');
});

test('runSession writes four files and returns a diff the second time', async (t) => {
  const theme = makeTheme(tmp(t));
  const out = path.join(tmp(t), 'out');
  const first = await runSession({ input: theme, out, engines: [found] });
  assert.equal(first.files.length, 4);
  assert.equal(first.dir, out);
  assert.equal(first.diff, undefined);
  const second = await runSession({ input: theme, out, engines: [found] });
  assert.equal(second.diff?.open.length, 1);
});

const cli = (args: string[]) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ['src/cli.ts', ...args], { cwd: root, env: { ...process.env, WP_SHAKEDOWN_HOME: testHome } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });

test('ui rejects a missing folder and a bad port', async () => {
  const folder = await cli(['ui', '/no/such/folder']);
  assert.equal(folder.status, 2);
  assert.match(folder.stderr, /is not a folder/);
  const port = await cli(['ui', '--port', 'abc']);
  assert.equal(port.status, 2);
  assert.match(port.stderr, /--port must be a number from 0 to 65535\./);
});

test('ui prints its address and stops on SIGINT', { skip: process.platform === 'win32' }, async (t) => {
  const child = spawn(process.execPath, ['src/cli.ts', 'ui', tmp(t), '--no-open', '--port', '0'], {
    cwd: root,
    env: { ...process.env, WP_SHAKEDOWN_HOME: testHome },
  });
  t.after(() => child.kill());
  const exit = new Promise<number | null>((resolve) => child.on('close', resolve));
  const line = await new Promise<string>((resolve) => {
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
      if (out.includes('\n')) resolve(out);
    });
  });
  assert.match(line, /^wp-shakedown is running at http:\/\/127\.0\.0\.1:\d+\/\?t=/);
  child.kill('SIGINT');
  assert.equal(await exit, 0);
});

test('static routes serve only the page and plain file names under assets', async (t) => {
  const ui = await startUi({ engines: [], startDir: tmp(t), port: 0 });
  t.after(() => ui.close());
  const get = (route: string) => fetch(`http://127.0.0.1:${ui.port}${route}`);
  for (const route of ['/assets/..%2F..%2Fpackage.json', '/assets/../package.json', '/assets/.env', '/assets/a/b.js', '/assets/x.exe', '/package.json']) {
    const res = await get(route);
    assert.equal(res.status, 404, route);
    await res.arrayBuffer();
  }
  const missing = await get('/assets/nope.js');
  assert.equal(missing.status, 404);
  assert.ok(missing.headers.get('content-security-policy')?.includes("script-src 'self'"));
});
