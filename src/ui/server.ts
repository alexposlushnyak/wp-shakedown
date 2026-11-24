import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { customEngines } from '../engines/custom.ts';
import { profiles } from '../profiles.ts';
import { addProject, listProjects, removeProject } from '../projects.ts';
import { readPreviousRun } from '../report/write.ts';
import { runSession } from '../session.ts';
import type { SessionResult } from '../session.ts';
import { detectTarget } from '../target.ts';
import { DEPTHS } from '../types.ts';
import type { Depth, Engine, RunEvent } from '../types.ts';
import { VERSION } from '../version.ts';

export interface UiServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

type WireEvent =
  | { type: 'run:start'; target: { kind: string; name: string; path: string; units: number }; jobs: { engine: string; unit?: string }[] }
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
const MAX_RUNNING = 3;
const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
const REPORT_FILES = ['report.md', 'report.json', 'report.sarif', 'report.html'];

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

export function startUi(opts: { engines: Engine[]; port?: number; startDir?: string; token?: string }): Promise<UiServer> {
  const token = opts.token ?? randomBytes(24).toString('base64url');
  const startDir = path.resolve(opts.startDir ?? process.cwd());
  let port = 0;
  const clients = new Set<http.ServerResponse>();

  interface Active {
    path: string;
    state: 'queued' | 'running';
    controller: AbortController;
    events: WireEvent[];
    depth?: Depth;
    profile?: string;
    experimental?: boolean;
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

  function readBody(req: http.IncomingMessage): Promise<string | undefined> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          resolve(undefined);
          req.removeAllListeners('data');
          req.resume();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolve(undefined));
    });
  }

  function begin(id: string, a: Active): void {
    const ctl = a.controller;
    a.state = 'running';
    finished.delete(id);
    let ended = false;
    let session: SessionResult | undefined;
    broadcast('projects', {});
    runSession({
      input: a.path,
      ...(a.profile ? { profile: a.profile } : {}),
      ...(a.depth ? { depth: a.depth } : {}),
      ...(a.experimental ? { experimental: true } : {}),
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
      '/api/detect': 'GET',
      '/api/projects': 'GET, POST',
      '/api/projects/remove': 'POST',
      '/api/run': 'POST',
      '/api/cancel': 'POST',
      '/api/report': 'GET',
      '/api/report.html': 'GET',
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
          engines: [...opts.engines, ...customEngines()].map(({ id, title, kinds, depth, experimental }) => ({ id, title, kinds, depth: depth ?? 'standard', ...(experimental ? { experimental } : {}) })),
          profiles: profiles.map(({ id, title, summary, kinds }) => ({ id, title, summary, kinds })),
        });

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
        const depth = body.depth;
        if (depth !== undefined && !DEPTHS.some((d) => d === depth)) return send(res, 400, { error: `Unknown depth "${String(depth)}".` });
        const profile = body.profile;
        if (profile !== undefined) {
          const found = typeof profile === 'string' ? profiles.find((p) => p.id === profile) : undefined;
          if (!found) return send(res, 400, { error: `Unknown profile "${String(profile)}".` });
          if (chosen.length > 1) return send(res, 400, { error: 'A profile works with one project.' });
          if (!found.kinds.includes(chosen[0]!.kind!)) return send(res, 400, { error: `The ${found.id} profile does not fit "${chosen[0]!.name}".` });
        }
        const started: string[] = [];
        for (const p of chosen as NonNullable<(typeof chosen)[number]>[]) {
          if (active.has(p.id)) continue;
          active.set(p.id, {
            path: p.path,
            state: 'queued',
            controller: new AbortController(),
            events: [],
            ...(depth ? { depth: depth as Depth } : {}),
            ...(profile ? { profile: profile as string } : {}),
            ...(body.experimental === true ? { experimental: true } : {}),
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
        return send(res, 200, {
          summary: result.summary,
          engines: result.engines,
          finishedAt: result.finishedAt,
          ...(result.profile ? { profile: result.profile } : {}),
          ...(result.depth ? { depth: result.depth } : {}),
          ...(result.experimental ? { experimental: true } : {}),
          ...(diff ? { diff: { fixed: diff.fixed.length, added: diff.added.length, open: diff.open.length } } : {}),
          files: found.session?.files ?? REPORT_FILES.map((f) => path.join(found.dir, f)),
          dir: found.dir,
        });
      }

      case '/api/report.html': {
        const found = reportOf(url.searchParams.get('id') ?? '');
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
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/?t=${token}`,
        port,
        token,
        close: () =>
          new Promise<void>((done) => {
            queue.length = 0;
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
