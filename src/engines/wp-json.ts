import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Ajv } from 'ajv';
import { getJson, Unreachable } from '../net.ts';
import { EngineSkipped } from '../types.ts';
import type { Engine, RawFinding, Target } from '../types.ts';

type Kind = 'theme' | 'block';

export function jsonFiles(target: Target): { file: string; kind: Kind }[] {
  if (statSync(target.path).isFile()) return [];
  const out: { file: string; kind: Kind }[] = [];
  const walk = (dir: string, visit: (file: string, name: string) => void): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'vendor' && e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p, visit);
      } else if (e.isFile()) visit(p, e.name);
    }
  };
  if (target.kind === 'theme') {
    const top = path.join(target.path, 'theme.json');
    if (existsSync(top)) out.push({ file: top, kind: 'theme' });
    const styles = path.join(target.path, 'styles');
    if (existsSync(styles) && statSync(styles).isDirectory()) {
      walk(styles, (p, n) => {
        if (n.endsWith('.json')) out.push({ file: p, kind: 'theme' });
      });
    }
  }
  walk(target.path, (p, n) => {
    if (n === 'block.json') out.push({ file: p, kind: 'block' });
  });
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

export function schemaUrl(kind: Kind, declared: unknown): string {
  if (typeof declared === 'string') {
    const m = /^https:\/\/schemas\.wp\.org\/(?:trunk|wp\/\d+\.\d+)\/(theme|block)\.json$/.exec(declared);
    if (m && m[1] === kind) return declared;
  }
  return `https://schemas.wp.org/trunk/${kind}.json`;
}

const WEEK = 7 * 24 * 3600 * 1000;

export async function loadSchema(url: string): Promise<object> {
  const skip = new EngineSkipped(`Cannot download ${url}. The engine needs the schema once and then works offline for a week.`);
  try {
    const r = await getJson(url, { ttlMs: WEEK });
    if (r.status === 200 && r.data && typeof r.data === 'object') return r.data;
  } catch (err) {
    if (!(err instanceof Unreachable)) throw err;
  }
  throw skip;
}

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
const validators = new WeakMap<object, ReturnType<Ajv['compile']>>();
const SKIP = new Set(['if', 'then', 'else', 'anyOf', 'oneOf', 'allOf', 'not']);

export function validate(schema: object, data: unknown): { rule: string; message: string }[] {
  let v = validators.get(schema);
  if (!v) validators.set(schema, (v = ajv.compile(schema)));
  v(data);
  const seen = new Set<string>();
  const out: { rule: string; message: string }[] = [];
  for (const e of v.errors ?? []) {
    if (SKIP.has(e.keyword)) continue;
    // A name that propertyNames rejects also produces errors about the name itself. The propertyNames error says it all.
    if ('propertyName' in e && e.keyword !== 'propertyNames') continue;
    const where = e.instancePath || '/';
    let message = `${where}: ${e.message}`;
    // The WordPress schemas reject an unknown name with additionalProperties in some places and with propertyNames in others.
    if (e.keyword === 'additionalProperties') message = `${where}: "${(e.params as { additionalProperty: string }).additionalProperty}" is not a known property`;
    if (e.keyword === 'propertyNames') message = `${where}: "${(e.params as { propertyName: string }).propertyName}" is not a known property`;
    if (e.keyword === 'enum') message += `: ${(e.params as { allowedValues: unknown[] }).allowedValues.slice(0, 8).join(', ')}`;
    const rule = `schema.${e.keyword}`;
    const key = `${rule}\n${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ rule, message });
  }
  return out.slice(0, 50);
}

export function syntaxFinding(err: unknown): { message: string; line?: number } {
  const message = err instanceof Error ? err.message : String(err);
  const m = /\(line (\d+) column \d+\)/.exec(message);
  return { message, ...(m ? { line: Number(m[1]) } : {}) };
}

export const wpJson: Engine = {
  id: 'wp-json',
  title: 'theme.json and block.json',
  kinds: ['theme', 'plugin'],
  async run({ target, signal }) {
    const files = jsonFiles(target);
    const out: RawFinding[] = [];
    const schemas = new Map<string, Promise<object>>();
    for (const { file, kind } of files) {
      if (signal?.aborted) break;
      const rel = path.relative(target.path, file).split(path.sep).join('/');
      let data: unknown;
      try {
        data = JSON.parse(readFileSync(file, 'utf8'));
      } catch (err) {
        const s = syntaxFinding(err);
        out.push({ rule: 'json.syntax', severity: 'error', category: 'correctness', message: s.message, location: { file: rel, ...(s.line ? { line: s.line } : {}) } });
        continue;
      }
      const url = schemaUrl(kind, (data as { $schema?: unknown } | null)?.$schema);
      let pending = schemas.get(url);
      if (!pending) schemas.set(url, (pending = loadSchema(url)));
      const schema = await pending;
      for (const v of validate(schema, data)) {
        // shortcut: no line number. Mapping a JSON path to a line needs a position-aware parser. Add one when people ask where in the file.
        out.push({ rule: v.rule, severity: 'warning', category: 'correctness', message: v.message, location: { file: rel } });
      }
    }
    return out;
  },
};
