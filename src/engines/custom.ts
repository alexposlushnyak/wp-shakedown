import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Ajv } from 'ajv';
import { home } from '../home.ts';
import { DEFAULT_LEVEL, EngineSkipped, LEVEL_NAMES, MAX_LEVEL } from '../types.ts';
import type { Category, Depth, Engine, RawFinding, Severity, Target } from '../types.ts';

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');

/** Turns a glob into a RegExp that matches a POSIX relative path. Supports **, *, ? and {a,b}. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '{' && glob.indexOf('}', i) > i) {
      const end = glob.indexOf('}', i);
      out += `(?:${glob.slice(i + 1, end).split(',').map(esc).join('|')})`;
      i = end;
    } else out += esc(c);
  }
  return new RegExp(`^${out}$`);
}

const CATEGORIES: Category[] = ['security', 'compatibility', 'standards', 'correctness', 'performance', 'accessibility', 'i18n', 'health', 'other'];
const strings = (extra: object = {}): object => ({ type: 'array', items: { type: 'string' }, ...extra });
const globs = { oneOf: [{ type: 'string' }, strings({ minItems: 1 })] };

const common = {
  title: { type: 'string' },
  kinds: { type: 'array', items: { enum: ['theme', 'plugin', 'install'] }, minItems: 1 },
  paths: strings({ minItems: 1 }),
  level: { type: 'integer', minimum: 0, maximum: MAX_LEVEL },
  depth: { enum: Object.keys(LEVEL_NAMES) },
  severity: { enum: ['error', 'warning', 'info'] },
  category: { enum: CATEGORIES },
  message: { type: 'string' },
  hint: { type: 'string' },
  onError: { enum: ['fail', 'skip', 'warn'] },
};
const schemaFor = (type: string, properties: object, extra: object = {}): object => ({
  type: 'object',
  properties: { type: { const: type }, ...common, ...properties },
  required: ['type'],
  additionalProperties: false,
  ...extra,
});
const ajv = new Ajv({ strict: false });
const validators: Record<string, ReturnType<Ajv['compile']>> = {
  pattern: ajv.compile(
    schemaFor(
      'pattern',
      { files: globs, forbid: { type: 'string' }, require: { type: 'string' }, flags: { type: 'string' } },
      { required: ['type', 'files', 'message'], oneOf: [{ required: ['forbid'], not: { required: ['require'] } }, { required: ['require'], not: { required: ['forbid'] } }] },
    ),
  ),
  files: ajv.compile(schemaFor('files', { require: strings(), forbid: strings() }, { anyOf: [{ required: ['require'] }, { required: ['forbid'] }] })),
  command: ajv.compile(
    schemaFor('command', { run: { type: 'string' }, expectExit: { type: 'integer' }, timeoutSeconds: { type: 'number', exclusiveMinimum: 0 } }, { required: ['type', 'run'] }),
  ),
  none: ajv.compile({ type: 'object', properties: { type: { enum: ['pattern', 'files', 'command'] } }, required: ['type'] }),
};

interface Check {
  type: 'pattern' | 'files' | 'command';
  title?: string;
  kinds?: ('theme' | 'plugin' | 'install')[];
  paths?: string[];
  level?: number;
  /** Old name of `level`. */
  depth?: Depth;
  severity?: Severity;
  category?: Category;
  message?: string;
  hint?: string;
  onError?: 'fail' | 'skip' | 'warn';
  files?: string | string[];
  forbid?: string | string[];
  require?: string | string[];
  flags?: string;
  run?: string;
  expectExit?: number;
  timeoutSeconds?: number;
}

/** The check itself cannot run. This is not a finding about the target. */
class CheckError extends Error {}

const posix = (p: string): string => p.split(path.sep).join('/');
const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const MAX_FILE = 2 * 1024 * 1024;

/** The files of the target as POSIX paths relative to its folder. */
export function walk(target: Target): { root: string; files: string[] } {
  if (statSync(target.path).isFile()) return { root: path.dirname(target.path), files: [path.basename(target.path)] };
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'vendor') visit(full);
      } else if (e.isFile()) files.push(posix(path.relative(target.path, full)));
    }
  };
  visit(target.path);
  return { root: target.path, files: files.sort() };
}

function runCommand(check: Check, target: Target, cwd: string, signal: AbortSignal | undefined): Promise<{ code: number; output: string }> {
  const seconds = check.timeoutSeconds ?? 120;
  return new Promise((resolve, reject) => {
    let output = '';
    let timedOut = false;
    // The shell gets its own process group, so a stop reaches the commands the shell started and not only the shell.
    const group = process.platform !== 'win32';
    const child = spawn(check.run!, { shell: true, cwd, env: { ...process.env, WP_SHAKEDOWN_TARGET: target.path }, detached: group });
    const stop = (): void => {
      try {
        if (group && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill();
      } catch {
        // It already ended.
      }
    };
    const onAbort = (): void => {
      stop();
      reject(signal!.reason instanceof Error ? signal!.reason : new Error('The run was stopped.'));
    };
    if (signal?.aborted) onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    // Reject at the timeout without waiting for the pipes to close. A grandchild can keep them open.
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
      reject(new CheckError(`The command did not finish in ${seconds} seconds.`));
    }, seconds * 1000);
    child.stdout.setEncoding('utf8').on('data', (d: string) => (output += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (output += d));
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    child.on('error', (err) => {
      done();
      reject(new CheckError(`The command could not start: ${err.message}.`));
    });
    child.on('close', (code) => {
      done();
      if (timedOut || signal?.aborted) return;
      const n = code ?? 1;
      if (n === 126 || n === 127) return reject(new CheckError(`The command was not found or could not run (exit code ${n}).`));
      resolve({ code: n, output });
    });
  });
}

async function runCheck(name: string, check: Check, target: Target, signal: AbortSignal | undefined): Promise<RawFinding[]> {
  const title = check.title ?? name;
  const make = (message: string, location: RawFinding['location'], hint = check.hint): RawFinding => ({
    rule: name,
    severity: check.severity ?? 'error',
    category: check.category ?? 'other',
    message,
    location,
    ...(hint ? { hint } : {}),
  });

  if (check.type === 'command') {
    const cwd = statSync(target.path).isFile() ? path.dirname(target.path) : target.path;
    const { code, output } = await runCommand(check, target, cwd, signal);
    if (code === (check.expectExit ?? 0)) return [];
    const tail = output.split(/\r?\n/).filter((l) => l.trim() !== '').slice(-10).join('\n').slice(-1000);
    const hint = check.hint ?? (tail || undefined);
    return [make(check.message ?? `${title} failed with exit code ${code}.`, {}, hint)];
  }

  const { root, files } = walk(target);
  if (check.type === 'files') {
    const out: RawFinding[] = [];
    for (const g of list(check.require)) {
      const re = globToRegExp(g);
      if (!files.some((f) => re.test(f))) out.push(make(check.message ?? `Nothing matches "${g}".`, {}));
    }
    for (const g of list(check.forbid)) {
      const re = globToRegExp(g);
      for (const f of files) if (re.test(f)) out.push(make(check.message ?? 'This file must not be here.', { file: f }));
    }
    return out;
  }

  let re: RegExp;
  try {
    re = new RegExp((check.forbid ?? check.require) as string, check.flags ?? '');
  } catch (err) {
    throw new CheckError(`The pattern is not a valid regular expression: ${err instanceof Error ? err.message : String(err)}.`);
  }
  const wanted = list(check.files).map(globToRegExp);
  const out: RawFinding[] = [];
  let matched = false;
  for (const f of files) {
    if (!wanted.some((w) => w.test(f))) continue;
    const full = path.join(root, f);
    if (statSync(full).size > MAX_FILE) continue;
    const text = readFileSync(full, 'utf8');
    if (check.require !== undefined) {
      re.lastIndex = 0;
      if (re.test(text)) matched = true;
      continue;
    }
    text.split(/\r?\n/).forEach((line, i) => {
      re.lastIndex = 0;
      if (re.test(line)) out.push(make(check.message!, { file: f, line: i + 1 }));
    });
  }
  if (check.require !== undefined && !matched) out.push(make(check.message!, {}));
  return out;
}

function failing(name: string, reason: string): Engine {
  return {
    id: `custom:${name}`,
    title: name,
    kinds: ['theme', 'plugin', 'install'],
    level: 0,
    async run() {
      throw new Error(`The check file ${name}.json is not valid: ${reason}.`);
    },
  };
}

function toEngine(name: string, check: Check): Engine {
  return {
    id: `custom:${name}`,
    title: check.title ?? name,
    kinds: check.kinds ?? ['theme', 'plugin'],
    level: check.level ?? (check.depth ? LEVEL_NAMES[check.depth] : DEFAULT_LEVEL),
    async run({ target, signal }) {
      try {
        return await runCheck(name, check, target, signal);
      } catch (err) {
        if (!(err instanceof CheckError)) throw err;
        const how = check.onError ?? 'fail';
        if (how === 'skip') throw new EngineSkipped(err.message);
        if (how === 'warn') {
          return [{ rule: name, severity: 'warning', category: 'other', message: `The check could not run: ${err.message}`, location: {} }];
        }
        throw new Error(err.message);
      }
    },
  };
}

/** The checks in <home>/checks as engines. With a target, only the checks whose `paths` fit it. */
export function customEngines(target?: Target): Engine[] {
  const dir = path.join(home(), 'checks');
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir)
    .filter((n) => /^[a-z0-9][a-z0-9-]*\.json$/.test(n))
    .sort();
  const out: Engine[] = [];
  for (const file of names) {
    const name = file.slice(0, -'.json'.length);
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      out.push(failing(name, 'it is not JSON'));
      continue;
    }
    const type = (data as { type?: unknown } | null)?.type;
    const validate = validators[typeof type === 'string' && type in validators && type !== 'none' ? type : 'none']!;
    if (!validate(data)) {
      const e = validate.errors![0]!;
      const unknown = e.keyword === 'additionalProperties' ? (e.params as { additionalProperty?: string }).additionalProperty : undefined;
      out.push(failing(name, unknown ? `it has a field the format does not know, "${unknown}"` : `${e.instancePath || 'the file'} ${e.message}`));
      continue;
    }
    const check = data as Check;
    if (target && check.paths) {
      const p = posix(target.path);
      if (!check.paths.some((g) => globToRegExp(g).test(p))) continue;
    }
    out.push(toEngine(name, check));
  }
  return out;
}
