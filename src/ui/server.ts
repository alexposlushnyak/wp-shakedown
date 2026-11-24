import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { profiles } from '../profiles.ts';
import { runSession } from '../session.ts';
import type { SessionResult } from '../session.ts';
import { detectTarget } from '../target.ts';
import type { Engine, RunEvent } from '../types.ts';
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
  let controller: AbortController | undefined;
  let events: WireEvent[] = [];
  let last: SessionResult | undefined;
  const clients = new Set<http.ServerResponse>();

  const send = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const sse = (res: http.ServerResponse, name: string, data: unknown): void => {
    res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const push = (e: WireEvent): void => {
    events.push(e);
    for (const c of clients) sse(c, 'run', e);
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

  function start(input: string, type: 'theme' | 'plugin' | 'install' | undefined, only: string[] | undefined, profile: string | undefined): void {
    const ctl = new AbortController();
    controller = ctl;
    events = [];
    let ended = false;
    runSession({
      input,
      ...(type ? { type } : {}),
      ...(only ? { only } : {}),
      ...(profile ? { profile } : {}),
      engines: opts.engines,
      signal: ctl.signal,
      onEvent: (e) => {
        // A stopped run reports one message, not a partial result.
        if (e.type === 'run:end' && ctl.signal.aborted) return;
        if (e.type === 'run:end') ended = true;
        push(toWire(e));
      },
    })
      .then((s) => {
        if (!ctl.signal.aborted) last = s;
      })
      .catch((err: unknown) => {
        if (!ctl.signal.aborted) push({ type: 'run:error', message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        if (ctl.signal.aborted && !ended) push({ type: 'run:error', message: 'The run was stopped.' });
        if (controller === ctl) controller = undefined;
      });
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
      '/api/run': 'POST',
      '/api/cancel': 'POST',
      '/api/report': 'GET',
      '/api/events': 'GET',
    };
    const want = methods[route];
    if (!want) return send(res, 404, { error: 'Not found.' });
    if (method !== want) return send(res, 405, { error: 'Method not allowed.' });

    switch (route) {
      case '/api/state':
        return send(res, 200, {
          version: VERSION,
          home: os.homedir(),
          startDir,
          engines: opts.engines.map(({ id, title, kinds }) => ({ id, title, kinds })),
          profiles: profiles.map(({ id, title, summary, kinds }) => ({ id, title, summary, kinds })),
          running: controller !== undefined,
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

      case '/api/run': {
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'Send JSON.' });
        const text = await readBody(req);
        if (text === undefined) {
          res.setHeader('Connection', 'close');
          return send(res, 413, { error: 'The request is too large.' });
        }
        type Body = { path?: unknown; type?: unknown; engines?: unknown; profile?: unknown } | null;
        const body = ((): Body => {
          try {
            return JSON.parse(text) as Body;
          } catch {
            return null; // answered as a missing path
          }
        })();
        if (!body || typeof body.path !== 'string' || body.path === '') return send(res, 400, { error: 'Send a path.' });
        if (controller) return send(res, 409, { error: 'A run is in progress.' });
        const type = body.type === 'theme' || body.type === 'plugin' || body.type === 'install' ? body.type : undefined;
        const ids = Array.isArray(body.engines) ? body.engines.filter((x): x is string => typeof x === 'string') : [];
        const profile = body.profile;
        if (profile !== undefined && (typeof profile !== 'string' || !profiles.some((p) => p.id === profile))) {
          return send(res, 400, { error: `Unknown profile "${String(profile)}".` });
        }
        if (profile !== undefined && ids.length > 0) return send(res, 400, { error: 'Use a profile or a list of engines, not both.' });
        try {
          detectTarget(body.path, type ? { type } : {});
        } catch (err) {
          return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        for (const id of ids) {
          if (!opts.engines.some((e) => e.id === id)) return send(res, 400, { error: `Unknown engine "${id}".` });
        }
        start(body.path, type, ids.length > 0 ? ids : undefined, profile as string | undefined);
        return send(res, 202, { ok: true });
      }

      case '/api/cancel':
        controller?.abort();
        return send(res, 200, { ok: true });

      case '/api/report': {
        if (!last) return send(res, 404, { error: 'No report yet.' });
        const { result, diff, files, dir } = last;
        return send(res, 200, { result, ...(diff ? { diff } : {}), files, dir });
      }

      default: {
        res.writeHead(200, {
          ...HEADERS,
          'Content-Type': 'text/event-stream; charset=utf-8',
          Connection: 'keep-alive',
        });
        sse(res, 'snapshot', { running: controller !== undefined, events });
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
            controller?.abort();
            for (const c of clients) c.end();
            clients.clear();
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
