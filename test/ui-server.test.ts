import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { runSession } from '../src/session.ts';
import { startUi } from '../src/ui/server.ts';
import type { Engine } from '../src/types.ts';
import { root, testHome } from './env.ts';
import { fakeEngine, makeTheme, raw, tmp, write, zipOf } from './helpers.ts';

const found = fakeEngine('found', ['theme'], async () => [raw()]);

async function boot(t: TestContext, engines: Engine[] = [found], extra: Partial<Parameters<typeof startUi>[0]> = {}) {
  const home = tmp(t);
  const old = process.env.WP_SHAKEDOWN_HOME;
  process.env.WP_SHAKEDOWN_HOME = home;
  t.after(() => {
    if (old === undefined) delete process.env.WP_SHAKEDOWN_HOME;
    else process.env.WP_SHAKEDOWN_HOME = old;
  });
  const startDir = tmp(t);
  const ui = await startUi({ engines, startDir, port: 0, ...extra });
  t.after(() => ui.close());
  const base = `http://127.0.0.1:${ui.port}`;
  const api = (p: string, init: RequestInit = {}) =>
    fetch(base + p, { ...init, headers: { 'x-shakedown-token': ui.token, ...init.headers } });
  const post = (p: string, body: unknown) =>
    api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ui, base, api, post, startDir };
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail('The condition never held.');
}

type Project = { id: string; run?: string; last?: { summary: { error: number } } };

/** Adds a theme as a project and returns its ID. */
async function addTheme(t: TestContext, post: (p: string, b: unknown) => Promise<Response>, name: string): Promise<string> {
  const res = await post('/api/projects', { path: makeTheme(tmp(t), name) });
  assert.equal(res.status, 200);
  return ((await res.json()) as { project: Project }).project.id;
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
  const body = (await ok.json()) as { engines: { id: string; level: number }[]; running?: boolean };
  assert.deepEqual(body.engines.map((e) => e.id), ['found']);
  assert.equal(body.engines[0]!.level, 6);
  assert.equal('running' in body, false);
  const state = (await (await fetch(`${base}/api/state`, { headers: { 'x-shakedown-token': ui.token } })).json()) as { presets: { id: string; builtIn?: true }[] };
  assert.equal(state.presets.length, 5);
  assert.ok(state.presets.every((p) => p.builtIn === true));
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

test('projects can be added, listed and removed', async (t) => {
  const { api, post } = await boot(t);
  assert.deepEqual(await (await api('/api/projects')).json(), { projects: [] });
  const dir = makeTheme(tmp(t), 'Alpha');
  const added = await post('/api/projects', { path: dir });
  assert.equal(added.status, 200);
  const body = (await added.json()) as { project: Project & { name: string; kind: string }; added: boolean };
  assert.equal(body.added, true);
  assert.deepEqual([body.project.name, body.project.kind], ['Alpha', 'theme']);
  assert.equal(((await (await post('/api/projects', { path: dir })).json()) as { added: boolean }).added, false);
  assert.equal(((await (await api('/api/projects')).json()) as { projects: unknown[] }).projects.length, 1);

  const none = await post('/api/projects', { path: tmp(t) });
  assert.equal(none.status, 400);
  assert.match(((await none.json()) as { error: string }).error, /^Cannot tell what/);
  assert.equal((await post('/api/projects', {})).status, 400);

  const missing = await post('/api/projects/remove', { id: 'nope' });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'No such project.' });
  assert.deepEqual(await (await post('/api/projects/remove', { id: body.project.id })).json(), { ok: true });
  assert.deepEqual(await (await api('/api/projects')).json(), { projects: [] });
});

test('a project with an active run cannot be removed', async (t) => {
  const slow = fakeEngine('slow', ['theme'], (ctx) => new Promise((_, reject) => ctx.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
  const { api, post } = await boot(t, [slow]);
  const id = await addTheme(t, post, 'Alpha');
  assert.equal((await post('/api/run', { ids: [id] })).status, 202);
  const busy = await post('/api/projects/remove', { id });
  assert.equal(busy.status, 409);
  assert.deepEqual(await busy.json(), { error: 'Stop the run first.' });
  await post('/api/cancel', {});
  await until(async () => ((await (await api('/api/projects')).json()) as { projects: Project[] }).projects[0]!.run === undefined);
  assert.equal((await post('/api/projects/remove', { id })).status, 200);
});

test('POST /api/run checks its input', async (t) => {
  const { api, post } = await boot(t);
  const plain = await api('/api/run', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(plain.status, 415);
  const id = await addTheme(t, post, 'Alpha');
  const other = await addTheme(t, post, 'Beta');
  for (const body of [{}, { ids: [] }, { ids: [1] }, { ids: 'x' }]) {
    const res = await post('/api/run', body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Send the projects to run.' });
  }
  const unknown = await post('/api/run', { ids: ['nope'] });
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { error: 'No such project.' });
  const levelError = { error: 'Level must be a number from 0 to 10, or quick, standard or deep.' };
  for (const bad of [{ level: 'nope' }, { level: 11 }, { level: -1 }, { level: 2.5 }, { depth: 'nope' }]) {
    const res = await post('/api/run', { ids: [id], ...bad });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), levelError);
  }
  for (const key of ['preset', 'profile']) {
    const res = await post('/api/run', { ids: [id], [key]: 'nope' });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Unknown preset "nope".' });
  }
  const two = await post('/api/run', { ids: [id, other], preset: 'wporg-theme' });
  assert.equal(two.status, 400);
  assert.deepEqual(await two.json(), { error: 'A preset works with one project.' });
  const big = await post('/api/run', { ids: ['x'.repeat(70000)] });
  assert.equal(big.status, 413);
});

test('a run of two projects streams tagged events and updates the list', async (t) => {
  const { api, post } = await boot(t);
  const a = await addTheme(t, post, 'Alpha');
  const b = await addTheme(t, post, 'Beta');
  const stream = await api('/api/events');
  assert.match(stream.headers.get('content-type') ?? '', /^text\/event-stream/);
  const next = frames(stream);
  const first = await next();
  assert.equal(first.event, 'snapshot');
  assert.deepEqual(first.data, { runs: [] });

  const started = await post('/api/run', { ids: [a, b] });
  assert.equal(started.status, 202);
  assert.deepEqual(await started.json(), { started: [a, b] });
  const types = new Map<string, string[]>();
  let lists = 0;
  while ((types.get(a)?.at(-1) !== 'run:end' || types.get(b)?.at(-1) !== 'run:end') || lists < 2) {
    const f = await next();
    if (f.event === 'projects') lists++;
    else if (f.event === 'run') types.set(f.data.id, [...(types.get(f.data.id) ?? []), f.data.event.type]);
  }
  assert.deepEqual(types.get(a), ['run:start', 'engine:start', 'engine:end', 'run:end']);
  assert.deepEqual(types.get(b), ['run:start', 'engine:start', 'engine:end', 'run:end']);

  await until(async () => ((await (await api('/api/projects')).json()) as { projects: Project[] }).projects.every((p) => p.last && !p.run));
  const { projects } = (await (await api('/api/projects')).json()) as { projects: Project[] };
  assert.deepEqual(projects.map((p) => p.last!.summary.error), [1, 1]);
});

test('a fourth run waits in the queue until one of three ends', async (t) => {
  const waiting: (() => void)[] = [];
  const gate = fakeEngine('gate', ['theme'], () => new Promise((resolve) => waiting.push(() => resolve([]))));
  const { api, post } = await boot(t, [gate]);
  const ids = [];
  for (const name of ['A', 'B', 'C', 'D']) ids.push(await addTheme(t, post, name));
  const states = async () => ((await (await api('/api/projects')).json()) as { projects: Project[] }).projects.map((p) => p.run);
  assert.equal((await post('/api/run', { ids })).status, 202);
  await until(() => waiting.length === 3);
  assert.deepEqual(await states(), ['running', 'running', 'running', 'queued']);
  waiting[0]!();
  await until(() => waiting.length === 4);
  assert.deepEqual(await states(), [undefined, 'running', 'running', 'running']);
  for (const release of waiting) release();
  await until(async () => (await states()).every((s) => s === undefined));
});

test('cancel stops one run or every run, and a queued run leaves the queue', async (t) => {
  const slow = fakeEngine('slow', ['theme'], (ctx) => new Promise((_, reject) => ctx.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
  const { api, post } = await boot(t, [slow]);
  const ids = [];
  for (const name of ['A', 'B', 'C', 'D']) ids.push(await addTheme(t, post, name));
  const next = frames(await api('/api/events'));
  await next();
  await post('/api/run', { ids });
  const states = async () => ((await (await api('/api/projects')).json()) as { projects: Project[] }).projects.map((p) => p.run);
  assert.deepEqual(await states(), ['running', 'running', 'running', 'queued']);

  // The queued run leaves without a run event.
  await post('/api/cancel', { id: ids[3] });
  assert.deepEqual(await states(), ['running', 'running', 'running', undefined]);

  await post('/api/cancel', { id: ids[0] });
  let stopped = false;
  while (!stopped) {
    const f = await next();
    stopped = f.event === 'run' && f.data.id === ids[0] && f.data.event.type === 'run:error';
    if (stopped) assert.equal(f.data.event.message, 'The run was stopped.');
  }
  await until(async () => (await states())[0] === undefined);
  assert.deepEqual(await states(), [undefined, 'running', 'running', undefined]);

  await post('/api/cancel', {});
  await until(async () => (await states()).every((s) => s === undefined));
});

test('a new connection starts with the events of an active run', async (t) => {
  const slow = fakeEngine('slow', ['theme'], (ctx) => new Promise((_, reject) => ctx.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
  const { api, post } = await boot(t, [slow]);
  const id = await addTheme(t, post, 'Alpha');
  await post('/api/run', { ids: [id] });
  await until(async () => {
    const f = await (await api('/api/events')).body!.getReader().read();
    return /engine:start/.test(new TextDecoder().decode(f.value));
  });
  const stream = await api('/api/events');
  const first = await frames(stream)();
  assert.equal(first.event, 'snapshot');
  const run = (first.data.runs as { id: string; state: string; events: { type: string }[] }[])[0]!;
  assert.deepEqual([run.id, run.state], [id, 'running']);
  assert.deepEqual(run.events.map((e) => e.type), ['run:start', 'engine:start']);
});

test('the report has a summary and no findings, and its page is served with its own policy', async (t) => {
  const { api, post } = await boot(t);
  const id = await addTheme(t, post, 'Alpha');
  const none = await api(`/api/report?id=${id}`);
  assert.equal(none.status, 404);
  assert.deepEqual(await none.json(), { error: 'No report yet.' });
  assert.equal((await api(`/api/report.html?id=${id}`)).status, 404);

  await post('/api/run', { ids: [id] });
  await until(async () => (await api(`/api/report?id=${id}`)).status === 200);
  const body = (await (await api(`/api/report?id=${id}`)).json()) as Record<string, any>;
  assert.equal(body.summary.error, 1);
  assert.equal(body.engines.length, 1);
  assert.equal('findings' in body, false);
  assert.equal('result' in body, false);
  assert.deepEqual(body.files.map((f: string) => path.basename(f)), ['report.md', 'report.json', 'report.sarif', 'report.html']);

  const html = await api(`/api/report.html?id=${id}`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type') ?? '', /^text\/html/);
  assert.equal(html.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'");
  assert.match(await html.text(), /<html/i);

  // A second run adds the diff.
  await post('/api/run', { ids: [id] });
  await until(async () => ((await (await api(`/api/report?id=${id}`)).json()) as { diff?: unknown }).diff !== undefined);
  assert.deepEqual(((await (await api(`/api/report?id=${id}`)).json()) as { diff: unknown }).diff, { fixed: 0, added: 0, open: 1 });
});

test('an engine that throws is a failed engine, not a run error', async (t) => {
  const bad = fakeEngine('bad', ['theme'], async () => {
    throw new Error('boom');
  });
  const { api, post } = await boot(t, [bad]);
  const id = await addTheme(t, post, 'Alpha');
  const next = frames(await api('/api/events'));
  await next();
  await post('/api/run', { ids: [id] });
  const types = [];
  while (types.length < 4) {
    const f = await next();
    if (f.event === 'run') types.push(f.data.event);
  }
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

test('/api/state reports whether a folder dialog exists', async (t) => {
  for (const [pick, want] of [[async () => '/x', true], [null, false]] as const) {
    const { api } = await boot(t, [found], { pick });
    assert.equal(((await (await api('/api/state')).json()) as { picker: boolean }).picker, want);
  }
});

test('/api/pick returns the chosen path or a cancel', async (t) => {
  const a = await boot(t, [found], { pick: async () => '/chosen' });
  assert.deepEqual(await (await a.post('/api/pick', {})).json(), { path: '/chosen' });
  const b = await boot(t, [found], { pick: async () => null });
  assert.deepEqual(await (await b.post('/api/pick', {})).json(), { cancelled: true });
});

test('/api/pick answers 501 without a dialog and 500 when it fails', async (t) => {
  const none = await boot(t, [found], { pick: null });
  assert.equal((await none.post('/api/pick', {})).status, 501);
  const bad = await boot(t, [found], { pick: async () => { throw new Error('no display'); } });
  const res = await bad.post('/api/pick', {});
  assert.equal(res.status, 500);
  assert.match(((await res.json()) as { error: string }).error, /no display/);
});

test('/api/pick allows one dialog at a time', async (t) => {
  let release!: (v: string) => void;
  const { post } = await boot(t, [found], { pick: () => new Promise<string>((r) => (release = r)) });
  const first = post('/api/pick', {});
  await until(() => release !== undefined);
  assert.equal((await post('/api/pick', {})).status, 409);
  release('/done');
  assert.deepEqual(await (await first).json(), { path: '/done' });
});

const themeZip = () => zipOf([{ name: 'aurora/style.css', data: '/*\nTheme Name: Aurora\n*/\n' }, { name: 'aurora/functions.php', data: '<?php\n' }]);

test('/api/upload adds the project and removing it deletes the unpacked folder', async (t) => {
  const { api, post } = await boot(t);
  const up = await api('/api/upload', { method: 'POST', headers: { 'content-type': 'application/zip', 'x-file-name': encodeURIComponent('aurora.zip') }, body: new Uint8Array(themeZip()) });
  assert.equal(up.status, 200);
  const { project, added } = (await up.json()) as { project: Project & { path: string }; added: boolean };
  assert.equal(added, true);
  assert.ok(existsSync(project.path));
  const list = (await (await api('/api/projects')).json()) as { projects: Project[] };
  assert.ok(list.projects.some((p) => p.id === project.id));
  assert.equal((await post('/api/projects/remove', { id: project.id })).status, 200);
  assert.ok(!existsSync(project.path));
});

test('/api/upload rejects other content types and bad archives', async (t) => {
  const { api } = await boot(t);
  const json = await api('/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(json.status, 415);
  const bad = await api('/api/upload', { method: 'POST', headers: { 'content-type': 'application/zip', 'x-file-name': encodeURIComponent('my theme.zip') }, body: 'not a zip at all, only text' });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /^my theme\.zip: /);
});

const mine = { id: 'mine', title: 'Mine', summary: 'My gate.', kinds: ['theme'], engines: ['found', 'nothing-here'], level: 6, failOn: 'warning' };

test('preset routes create, list, replace and remove a user preset', async (t) => {
  const { api, post } = await boot(t);
  const first = await post('/api/presets', mine);
  assert.equal(first.status, 200);
  const { builtIn: _b, ...saved } = ((await first.json()) as { preset: Record<string, unknown> }).preset;
  assert.deepEqual(saved, mine);

  const listed = (await (await api('/api/presets')).json()) as { presets: { id: string; builtIn?: true }[]; problems: unknown[] };
  assert.deepEqual(listed.presets.map((p) => p.id), ['wporg-theme', 'envato', 'wporg-plugin', 'client', 'site', 'mine']);
  assert.deepEqual(listed.problems, []);
  assert.equal(listed.presets.find((p) => p.id === 'mine')!.builtIn, undefined);
  const state = (await (await api('/api/state')).json()) as { presets: { id: string }[] };
  assert.equal(state.presets.length, 6);

  await post('/api/presets', { ...mine, title: 'Mine again' });
  const again = (await (await api('/api/presets')).json()) as { presets: { id: string; title: string }[] };
  assert.equal(again.presets.filter((p) => p.id === 'mine').length, 1);
  assert.equal(again.presets.find((p) => p.id === 'mine')!.title, 'Mine again');

  // A copy of the ThemeForest preset keeps Envato's Theme Check when the page saves it.
  const copy = await post('/api/presets', { ...mine, id: 'my-envato', directory: 'envato' });
  assert.equal(((await copy.json()) as { preset: { directory?: string } }).preset.directory, 'envato');
  assert.equal((await post('/api/presets/remove', { id: 'my-envato' })).status, 200);

  assert.equal((await post('/api/presets/remove', { id: 'mine' })).status, 200);
  assert.equal(((await (await api('/api/presets')).json()) as { presets: unknown[] }).presets.length, 5);
});

test('preset routes refuse bad input with a message', async (t) => {
  const { post } = await boot(t);
  const error = async (p: string, body: unknown, status: number) => {
    const res = await post(p, body);
    assert.equal(res.status, status);
    return ((await res.json()) as { error: string }).error;
  };
  assert.match(await error('/api/presets', { ...mine, id: 'envato' }, 400), /built-in preset/);
  assert.match(await error('/api/presets', { ...mine, id: 'Bad Id' }, 400), /lowercase letters/);
  assert.match(await error('/api/presets', { ...mine, level: 11 }, 400), /level/);
  assert.match(await error('/api/presets', { ...mine, engines: [] }, 400), /engines/);
  assert.equal(await error('/api/presets', { title: 'No id' }, 400), 'Send the ID of the preset.');
  assert.match(await error('/api/presets/remove', { id: 'site' }, 400), /built-in preset and cannot be removed/);
  assert.equal(await error('/api/presets/remove', { id: 'nope' }, 404), 'No such preset.');
  assert.equal(await error('/api/presets/remove', {}, 404), 'No such preset.');
});

test('a change to the presets is broadcast', async (t) => {
  const { api, post } = await boot(t);
  const next = frames(await api('/api/events'));
  assert.equal((await next()).event, 'snapshot');
  await post('/api/presets', mine);
  assert.equal((await next()).event, 'presets');
  await post('/api/presets/remove', { id: 'mine' });
  assert.equal((await next()).event, 'presets');
});

test('a run takes a preset and a level, by name or by number, and the report shows them', async (t) => {
  const { api, post } = await boot(t);
  await post('/api/presets', mine);
  const id = await addTheme(t, post, 'Alpha');
  const report = async () => {
    await until(async () => ((await (await api('/api/projects')).json()) as { projects: Project[] }).projects[0]!.run === undefined);
    return (await (await api(`/api/report?id=${id}`)).json()) as { preset?: string; level: number; engines: unknown[] };
  };
  assert.equal((await post('/api/run', { ids: [id], preset: 'mine' })).status, 202);
  const withPreset = await report();
  assert.deepEqual([withPreset.preset, withPreset.level, withPreset.engines.length], ['mine', 6, 1]);
  assert.equal((await post('/api/run', { ids: [id], level: 'quick' })).status, 202);
  assert.deepEqual([(await report()).level, (await report()).engines.length], [3, 0]);
  assert.equal((await post('/api/run', { ids: [id], depth: 'deep' })).status, 202);
  assert.equal((await report()).level, 8);
  assert.equal((await post('/api/run', { ids: [id], profile: 'mine', level: 9 })).status, 202);
  const old = await report();
  assert.deepEqual([old.preset, old.level], ['mine', 9]);
});
