import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { counts, runAssist } from '../assistant/assist.ts';
import { customEngines } from '../engines/custom.ts';
import { findPreset, listPresets, removePreset, savePreset } from '../presets.ts';
import { addProject, listProjects, projectId, removeProject } from '../projects.ts';
import { diffRuns } from '../diff.ts';
import { listRuns, previousOf, readRun } from '../history.ts';
import { toHtml } from '../report/html.ts';
import { defaultReportDir, readPreviousRun } from '../report/write.ts';
import { runSession } from '../session.ts';
import type { SessionResult } from '../session.ts';
import { detectTarget } from '../target.ts';
import { importZip } from '../uploads.ts';
import { pickerCommand, pickFolder } from './picker.ts';
import { parseLevel } from '../types.ts';
import type { AssistantReport, Engine, Preset, RunEvent } from '../types.ts';
import { VERSION } from '../version.ts';

export interface UiServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

type WireEvent =
  | { type: 'run:start'; target: { kind: string; name: string; path: string; units: number }; jobs: { engine: string }[] }
  | Exclude<RunEvent, { type: 'run:start' | 'run:end' }>
  | { type: 'run:end'; summary: unknown; finishedAt: string }
  | { type: 'run:error'; message: string };

// The page is a Vite build. Its files are index.html and the hashed files in assets/.
const UI_DIR = fileURLToPath(new URL('../../ui/dist/', import.meta.url));
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/** The file for a route, or undefined. Only index.html and a plain file name under /assets/ are served, so a URL cannot walk out of the folder. */
function staticFile(route: string): string | undefined {
  if (route === '/' || route === '/index.html') return 'index.html';
  const m = /^\/assets\/([A-Za-z0-9._-]+)$/.exec(route);
  return m && !m[1]!.startsWith('.') && TYPES[path.extname(m[1]!)] ? path.join('assets', m[1]!) : undefined;
}

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
};
const MAX_BODY = 65536;
const MAX_UPLOAD = 256 * 1024 ** 2;
const MAX_RUNNING = 3;
const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
const REPORT_FILES = ['report.md', 'report.json', 'report.sarif', 'report.html', 'report-short.md', 'report.csv'];

function toWire(e: RunEvent): WireEvent {
  if (e.type === 'run:start') {
    const { kind, name, path: p, units } = e.target;
    return { type: e.type, target: { kind, name, path: p, units: units.length }, jobs: e.jobs };
  }
  if (e.type === 'run:end') return { type: e.type, summary: e.result.summary, finishedAt: e.result.finishedAt };
  return e;
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function startUi(opts: {
  engines: Engine[];
  port?: number;
  /** The address to listen on. Only containers change it. The Host and Origin checks stay on 127.0.0.1 and localhost. */
  bind?: string;
  startDir?: string;
  token?: string;
  /** Opens the folder dialog. Tests replace it. Null means the system has none. */
  pick?: ((start: string, signal: AbortSignal) => Promise<string | null>) | null;
  /** Answers one assistant check. Tests replace it. */
  ask?: typeof import('../assistant/providers.ts').ask;
}): Promise<UiServer> {
  const token = opts.token ?? randomBytes(24).toString('base64url');
  const startDir = path.resolve(opts.startDir ?? process.cwd());
  let port = 0;
  const clients = new Set<http.ServerResponse>();
  const pick = opts.pick === undefined ? (pickerCommand(startDir) ? pickFolder : null) : opts.pick;
  const closing = new AbortController();
  let picking = false;
  const assisting = new Set<string>();

  interface Active {
    path: string;
    state: 'queued' | 'running';
    controller: AbortController;
    events: WireEvent[];
    level?: number;
    preset?: string;
  }
  const active = new Map<string, Active>();
  const queue: string[] = [];
  // What a page that connects later can still show: the last run of each project in this server session.
  const finished = new Map<string, { events: WireEvent[]; session?: SessionResult }>();

  const send = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const sse = (res: http.ServerResponse, name: string, data: unknown): void => {
    res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const broadcast = (name: string, data: unknown): void => {
    for (const c of clients) sse(c, name, data);
  };
  const push = (id: string, a: Active, event: WireEvent): void => {
    a.events.push(event);
    broadcast('run', { id, event });
  };

  function readRaw(req: http.IncomingMessage, limit: number): Promise<Buffer | undefined> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > limit) {
          resolve(undefined);
          req.removeAllListeners('data');
          req.resume();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => resolve(undefined));
    });
  }
  const readBody = async (req: http.IncomingMessage): Promise<string | undefined> => (await readRaw(req, MAX_BODY))?.toString('utf8');

  function begin(id: string, a: Active): void {
    const ctl = a.controller;
    a.state = 'running';
    finished.delete(id);
    let ended = false;
    let session: SessionResult | undefined;
    broadcast('projects', {});
    runSession({
      input: a.path,
      ...(a.preset ? { preset: a.preset } : {}),
      ...(a.level !== undefined ? { level: a.level } : {}),
      engines: opts.engines,
      signal: ctl.signal,
      onEvent: (e) => {
        // A stopped run reports one message, not a partial result.
        if (e.type === 'run:end' && ctl.signal.aborted) return;
        if (e.type === 'run:end') ended = true;
        push(id, a, toWire(e));
      },
    })
      .then((s) => {
        if (!ctl.signal.aborted) session = s;
      })
      .catch((err: unknown) => {
        if (!ctl.signal.aborted) push(id, a, { type: 'run:error', message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        if (ctl.signal.aborted && !ended) push(id, a, { type: 'run:error', message: 'The run was stopped.' });
        active.delete(id);
        finished.set(id, { events: a.events, ...(session ? { session } : {}) });
        pump();
        broadcast('projects', {});
      });
  }

  function pump(): void {
    const running = () => [...active.values()].filter((a) => a.state === 'running').length;
    while (running() < MAX_RUNNING && queue.length > 0) {
      const id = queue.shift()!;
      const a = active.get(id);
      if (a) begin(id, a);
    }
  }

  function cancel(id: string): void {
    const a = active.get(id);
    if (!a) return;
    const at = queue.indexOf(id);
    if (at >= 0) {
      queue.splice(at, 1);
      active.delete(id);
      broadcast('projects', {});
    } else a.controller.abort();
  }

  async function jsonBody(req: http.IncomingMessage, res: http.ServerResponse): Promise<Record<string, unknown> | undefined> {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
      send(res, 415, { error: 'Send JSON.' });
      return undefined;
    }
    const text = await readBody(req);
    if (text === undefined) {
      res.setHeader('Connection', 'close');
      send(res, 413, { error: 'The request is too large.' });
      return undefined;
    }
    try {
      const data = JSON.parse(text) as unknown;
      return data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** The report folder and finished session of a project, or undefined when it has no report. */
  function reportOf(id: string): { dir: string; session?: SessionResult } | undefined {
    const session = finished.get(id)?.session;
    if (session) return { dir: session.dir, session };
    const dir = listProjects().find((p) => p.id === id)?.last?.dir;
    return dir ? { dir } : undefined;
  }

  /** The report folder of a project, also before its first run. */
  function historyDir(id: string): string | undefined {
    const found = reportOf(id);
    if (found) return found.dir;
    const p = listProjects().find((x) => x.id === id);
    if (!p?.kind) return undefined;
    try {
      return defaultReportDir(detectTarget(p.path));
    } catch {
      return undefined;
    }
  }

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const route = url.pathname;
    const method = req.method ?? 'GET';

    if (!route.startsWith('/api/')) {
      const file = staticFile(route);
      if (!file || method !== 'GET') return send(res, file ? 405 : 404, { error: file ? 'Method not allowed.' : 'Not found.' });
      try {
        const body = readFileSync(path.join(UI_DIR, file));
        res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[path.extname(file)]! });
        res.end(body);
      } catch {
        send(res, 404, { error: 'Not found.' });
      }
      return;
    }

    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
      return send(res, 403, { error: 'Bad host.' });
    }
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
      return send(res, 403, { error: 'Bad origin.' });
    }
    const given = req.headers['x-shakedown-token'] ?? url.searchParams.get('t') ?? '';
    if (!same(Array.isArray(given) ? (given[0] ?? '') : given, token)) {
      return send(res, 401, { error: 'Missing or wrong token.' });
    }

    const methods: Record<string, string> = {
      '/api/state': 'GET',
      '/api/dirs': 'GET',
      '/api/pick': 'POST',
      '/api/upload': 'POST',
      '/api/detect': 'GET',
      '/api/projects': 'GET, POST',
      '/api/projects/remove': 'POST',
      '/api/presets': 'GET, POST',
      '/api/presets/remove': 'POST',
      '/api/run': 'POST',
      '/api/cancel': 'POST',
      '/api/assist': 'POST',
      '/api/report': 'GET',
      '/api/report.html': 'GET',
      '/api/history': 'GET',
      '/api/events': 'GET',
    };
    const want = methods[route];
    if (!want) return send(res, 404, { error: 'Not found.' });
    if (!want.split(', ').includes(method)) return send(res, 405, { error: 'Method not allowed.' });

    switch (route) {
      case '/api/state':
        return send(res, 200, {
          version: VERSION,
          home: os.homedir(),
          startDir,
          picker: pick !== null,
          engines: [...opts.engines, ...customEngines()].map(({ id, title, kinds, level }) => ({ id, title, kinds, level })),
          presets: listPresets().presets,
        });

      case '/api/presets': {
        if (method === 'GET') return send(res, 200, listPresets());
        const body = await jsonBody(req, res);
        if (!body) return;
        if (typeof body.id !== 'string') return send(res, 400, { error: 'Send the ID of the preset.' });
        try {
          const { id, title, summary, kinds, engines, level, failOn, directory, assistant } = body as unknown as Preset;
          savePreset({
            id,
            title,
            summary,
            kinds,
            engines,
            ...(level !== undefined ? { level } : {}),
            ...(failOn !== undefined ? { failOn } : {}),
            ...(directory !== undefined ? { directory } : {}),
            ...(assistant !== undefined ? { assistant } : {}),
          });
        } catch (err) {
          return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        broadcast('presets', {});
        return send(res, 200, { preset: findPreset(body.id) });
      }

      case '/api/presets/remove': {
        const body = await jsonBody(req, res);
        if (!body) return;
        try {
          if (typeof body.id !== 'string' || !removePreset(body.id)) return send(res, 404, { error: 'No such preset.' });
        } catch (err) {
          return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        broadcast('presets', {});
        return send(res, 200, { ok: true });
      }

      case '/api/dirs': {
        const given = url.searchParams.get('path');
        const p = given ?? startDir;
        if (!path.isAbsolute(p)) return send(res, 400, { error: 'Give an absolute path.' });
        if (!statSync(p, { throwIfNoEntry: false })?.isDirectory()) return send(res, 400, { error: `"${p}" is not a folder.` });
        let names: string[];
        try {
          names = readdirSync(p);
        } catch {
          return send(res, 400, { error: `Cannot read "${p}".` });
        }
        const dirs = names
          .filter((n) => !n.startsWith('.'))
          .filter((n) => statSync(path.join(p, n), { throwIfNoEntry: false })?.isDirectory())
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
          .map((name) => ({ name, path: path.join(p, name) }));
        const parent = path.dirname(p);
        return send(res, 200, { path: p, parent: parent === p ? null : parent, dirs });
      }

      case '/api/pick': {
        if (!pick) return send(res, 501, { error: 'This system has no folder dialog the tool can open. Type the path instead.' });
        if (picking) return send(res, 409, { error: 'The folder dialog is already open.' });
        picking = true;
        try {
          const chosen = await pick(startDir, closing.signal);
          return send(res, 200, chosen === null ? { cancelled: true } : { path: chosen });
        } catch (err) {
          return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        } finally {
          picking = false;
        }
      }

      case '/api/upload': {
        const type = req.headers['content-type'] ?? '';
        if (type !== 'application/zip' && type !== 'application/x-zip-compressed' && type !== 'application/octet-stream') {
          return send(res, 415, { error: 'Send a ZIP file.' });
        }
        let name = 'upload.zip';
        try {
          name = decodeURIComponent(String(req.headers['x-file-name'] ?? name));
        } catch {
          // A header that is not valid percent-encoding keeps the default name.
        }
        const buf = await readRaw(req, MAX_UPLOAD);
        if (!buf) {
          res.setHeader('Connection', 'close');
          return send(res, 413, { error: `The file is larger than ${MAX_UPLOAD / 1024 ** 2} MB.` });
        }
        try {
          const dir = importZip(buf, name, (d) => active.has(projectId(d)));
          finished.delete(projectId(dir));
          const added = addProject(dir);
          broadcast('projects', {});
          return send(res, 200, added);
        } catch (err) {
          return send(res, 400, { error: `${name}: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      case '/api/detect': {
        try {
          const t = detectTarget(url.searchParams.get('path') ?? '');
          return send(res, 200, {
            kind: t.kind,
            name: t.name,
            path: t.path,
            units: t.units.map((u) => ({ kind: u.kind, name: u.name, path: path.relative(t.path, u.path).split(path.sep).join('/') })),
          });
        } catch (err) {
          return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      }

      case '/api/projects': {
        if (method === 'GET') {
          return send(res, 200, { projects: listProjects().map((p) => ({ ...p, ...(active.has(p.id) ? { run: active.get(p.id)!.state } : {}) })) });
        }
        const body = await jsonBody(req, res);
        if (!body) return;
        if (typeof body.path !== 'string' || body.path === '') return send(res, 400, { error: 'Send a path.' });
        try {
          const added = addProject(body.path);
          if (added.added) broadcast('projects', {});
          return send(res, 200, added);
        } catch (err) {
          return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      }

      case '/api/projects/remove': {
        const body = await jsonBody(req, res);
        if (!body) return;
        const id = body.id;
        if (typeof id !== 'string' || !listProjects().some((p) => p.id === id)) return send(res, 404, { error: 'No such project.' });
        if (active.has(id)) return send(res, 409, { error: 'Stop the run first.' });
        removeProject(id);
        finished.delete(id);
        broadcast('projects', {});
        return send(res, 200, { ok: true });
      }

      case '/api/run': {
        const body = await jsonBody(req, res);
        if (!body) return;
        const ids = body.ids;
        if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === 'string')) return send(res, 400, { error: 'Send the projects to run.' });
        const all = listProjects();
        const chosen = (ids as string[]).map((id) => all.find((p) => p.id === id));
        if (chosen.some((p) => !p?.kind)) return send(res, 400, { error: 'No such project.' });
        const levelInput = body.level ?? body.depth;
        let level: number | undefined;
        if (levelInput !== undefined) {
          try {
            level = parseLevel(levelInput as string | number);
          } catch (err) {
            return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
          }
        }
        const preset = body.preset ?? body.profile;
        if (preset !== undefined) {
          const found = typeof preset === 'string' ? findPreset(preset) : undefined;
          if (!found) return send(res, 400, { error: `Unknown preset "${String(preset)}".` });
          if (chosen.length > 1) return send(res, 400, { error: 'A preset works with one project.' });
          if (!found.kinds.includes(chosen[0]!.kind!)) return send(res, 400, { error: `The ${found.id} preset does not fit "${chosen[0]!.name}".` });
        }
        const started: string[] = [];
        for (const p of chosen as NonNullable<(typeof chosen)[number]>[]) {
          if (active.has(p.id)) continue;
          active.set(p.id, {
            path: p.path,
            state: 'queued',
            controller: new AbortController(),
            events: [],
            ...(level !== undefined ? { level } : {}),
            ...(preset ? { preset: preset as string } : {}),
          });
          queue.push(p.id);
          started.push(p.id);
        }
        pump();
        if (started.length > 0) broadcast('projects', {});
        return send(res, 202, { started });
      }

      case '/api/cancel': {
        const text = await readBody(req);
        if (text === undefined) {
          res.setHeader('Connection', 'close');
          return send(res, 413, { error: 'The request is too large.' });
        }
        let id: unknown;
        try {
          id = (JSON.parse(text) as { id?: unknown } | null)?.id;
        } catch {
          // An empty or unreadable body means every run.
        }
        if (typeof id === 'string') cancel(id);
        else for (const key of [...active.keys()]) cancel(key);
        return send(res, 200, { ok: true });
      }

      case '/api/report': {
        const id = url.searchParams.get('id') ?? '';
        const found = reportOf(id);
        if (!found) return send(res, 404, { error: 'No report yet.' });
        const result = found.session?.result ?? readPreviousRun(found.dir);
        if (!result) return send(res, 404, { error: 'No report yet.' });
        const diff = found.session?.diff;
        let answers: { pass: number; fail: number; unsure: number; file: string } | undefined;
        try {
          const a = JSON.parse(readFileSync(path.join(found.dir, 'assistant.json'), 'utf8')) as AssistantReport;
          if (a.run === result.finishedAt) answers = { ...counts(a.answers), file: path.join(found.dir, 'assistant.md') };
        } catch {
          // No answers yet.
        }
        const provider = result.preset !== undefined ? findPreset(result.preset)?.assistant : undefined;
        return send(res, 200, {
          assistant: { checks: result.assistant?.length ?? 0, ...(provider ? { provider } : {}), ...(answers ? { answers } : {}) },
          summary: result.summary,
          engines: result.engines,
          finishedAt: result.finishedAt,
          ...(result.preset ? { preset: result.preset } : {}),
          ...(result.level !== undefined ? { level: result.level } : {}),
          ...(diff ? { diff: { fixed: diff.fixed.length, added: diff.added.length, open: diff.open.length } } : {}),
          // A folder written by an older version lacks the newer formats.
          files: found.session?.files ?? REPORT_FILES.map((f) => path.join(found.dir, f)).filter((f) => existsSync(f)),
          dir: found.dir,
        });
      }

      case '/api/assist': {
        const body = await jsonBody(req, res);
        if (!body) return;
        const id = typeof body.id === 'string' ? body.id : '';
        const p = listProjects().find((x) => x.id === id);
        const dir = historyDir(id);
        if (!p?.kind || !dir) return send(res, 404, { error: 'No such project.' });
        if (assisting.has(id)) return send(res, 409, { error: 'The assistant is already running for this project.' });
        // The answers belong to the last finished run, so wait for a run that is queued or going.
        if (active.has(id)) return send(res, 409, { error: 'The checks are running. Wait for them to finish.' });
        assisting.add(id);
        try {
          const { report, files } = await runAssist({ dir, target: detectTarget(p.path), signal: closing.signal, ...(opts.ask ? { ask: opts.ask } : {}) });
          return send(res, 200, { ...counts(report.answers), file: files[0] });
        } catch (err) {
          return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
        } finally {
          assisting.delete(id);
        }
      }

      case '/api/history': {
        const dir = historyDir(url.searchParams.get('id') ?? '');
        return send(res, 200, { runs: dir ? listRuns(dir) : [] });
      }

      case '/api/report.html': {
        const found = reportOf(url.searchParams.get('id') ?? '');
        const run = url.searchParams.get('run');
        if (run !== null) {
          const against = url.searchParams.get('against');
          const result = found ? readRun(found.dir, run) : undefined;
          if (!found || !result) return send(res, 404, { error: 'No such run.' });
          const entries = listRuns(found.dir);
          const base = against !== null ? readRun(found.dir, against) : (() => {
            const prev = previousOf(entries, run);
            return prev ? readRun(found.dir, prev.run) : undefined;
          })();
          if (against !== null && !base) return send(res, 404, { error: 'No such run.' });
          res.writeHead(200, { ...HEADERS, 'Content-Security-Policy': REPORT_CSP, 'Content-Type': TYPES['.html']! });
          return void res.end(toHtml(result, base ? diffRuns(base, result) : undefined, base?.finishedAt));
        }
        try {
          const body = readFileSync(path.join(found?.dir ?? '', 'report.html'));
          if (!found) throw new Error('none');
          res.writeHead(200, { ...HEADERS, 'Content-Security-Policy': REPORT_CSP, 'Content-Type': TYPES['.html']! });
          return void res.end(body);
        } catch {
          return send(res, 404, { error: 'No report yet.' });
        }
      }

      default: {
        res.writeHead(200, {
          ...HEADERS,
          'Content-Type': 'text/event-stream; charset=utf-8',
          Connection: 'keep-alive',
        });
        const runs = [
          ...[...finished].map(([id, f]) => ({ id, state: 'ended' as const, events: f.events })),
          ...[...active].map(([id, a]) => ({ id, state: a.state, events: a.events })),
        ];
        sse(res, 'snapshot', { runs });
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        res.on('close', () => {
          clearInterval(ping);
          clients.delete(res);
        });
      }
    }
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' });
      else res.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, opts.bind ?? '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/?t=${token}`,
        port,
        token,
        close: () =>
          new Promise<void>((done) => {
            queue.length = 0;
            closing.abort();
            for (const a of active.values()) a.controller.abort();
            for (const c of clients) c.end();
            clients.clear();
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
