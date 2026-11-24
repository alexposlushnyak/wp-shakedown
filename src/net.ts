import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { home } from './home.ts';

export class Unreachable extends Error {}

/** Tests replace `net.fetch`. */
export const net = { fetch: (url: string, init?: RequestInit): Promise<Response> => fetch(url, init) };

interface Cached {
  status: 200 | 404;
  data: unknown;
}

export interface GetJsonOptions {
  ttlMs: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** GET a JSON document with a disk cache. A stale cache answers when the network does not. */
export async function getJson(url: string, opts: GetJsonOptions): Promise<Cached> {
  const file = path.join(home(), 'cache', 'http', `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.json`);
  const read = (): Cached | undefined => {
    try {
      const c = JSON.parse(readFileSync(file, 'utf8')) as Cached;
      return c && (c.status === 200 || c.status === 404) ? c : undefined;
    } catch {
      return undefined;
    }
  };
  const store = (c: Cached): Cached => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(c));
    return c;
  };

  const stale = read();
  if (stale && Date.now() - statSync(file).mtimeMs < opts.ttlMs) return stale;

  const host = new URL(url).host;
  const timeout = AbortSignal.timeout(20000);
  let res: Response | undefined;
  try {
    res = await net.fetch(url, {
      ...(opts.headers ? { headers: opts.headers } : {}),
      signal: opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout,
    });
  } catch {
    // A network error falls back to the stale cache below.
  }
  if (res) {
    if (res.status === 401 || res.status === 403) throw new Unreachable(`${host} rejected the request (${res.status}).`);
    if (res.status === 200 || res.status === 404) {
      try {
        const text = await res.text();
        if (res.status === 200) return store({ status: 200, data: JSON.parse(text) });
        let data: unknown = null;
        try {
          data = JSON.parse(text);
        } catch {
          // A 404 body that is not JSON counts as no data.
        }
        return store({ status: 404, data });
      } catch {
        // A 200 body that does not parse falls back to the stale cache below.
      }
    }
    if (res.status === 429 && !stale) throw new Unreachable(`${host} asked to slow down (429).`);
  }
  if (stale) return stale;
  throw new Unreachable(`Cannot reach ${host}.`);
}
