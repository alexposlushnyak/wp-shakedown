import path from 'node:path';
import { applyBaseline } from './baseline.ts';
import { assignIds } from './fingerprint.ts';
import { VERSION } from './version.ts';
import { DEFAULT_LEVEL, EngineSkipped, MAX_LEVEL } from './types.ts';
import type {
  Baseline,
  Directory,
  Engine,
  EngineRun,
  Finding,
  RawFinding,
  RunEvent,
  RunResult,
  Severity,
  Summary,
  Target,
} from './types.ts';

export interface RunOptions {
  engines: Engine[];
  only?: string[];
  preset?: string;
  /** The directory whose rules the run applies, when the preset names one. */
  directory?: Directory;
  level?: number;
  baseline?: Baseline;
  signal?: AbortSignal;
  onEvent?: (e: RunEvent) => void;
  now?: () => Date;
}

const posix = (p: string): string => p.split('\\').join('/');

/** An absolute path inside base becomes relative to it. Anything else stays as given. */
function relInside(base: string, p: string): string {
  if (!path.isAbsolute(p)) return p;
  const r = path.relative(base, p);
  return r === '' || r.startsWith('..') || path.isAbsolute(r) ? p : r;
}

function sortKey(f: Finding): [string, number, number, string, string] {
  return [f.location.file ?? f.location.url ?? '', f.location.line ?? 0, f.location.column ?? 0, f.engine, f.rule];
}

function compare(a: Finding, b: Finding): number {
  const x = sortKey(a);
  const y = sortKey(b);
  return (
    (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0) ||
    x[1] - y[1] ||
    x[2] - y[2] ||
    (x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0) ||
    (x[4] < y[4] ? -1 : x[4] > y[4] ? 1 : 0)
  );
}

export async function run(target: Target, opts: RunOptions): Promise<RunResult> {
  const known = opts.engines.map((e) => e.id);
  for (const id of opts.only ?? []) {
    if (!known.includes(id)) throw new Error(`Unknown engine "${id}". Known engines: ${known.join(', ') || 'none'}.`);
  }
  const level = opts.level ?? DEFAULT_LEVEL;
  // Rules of a directory run at level 10 without a preset, so the command that runs one engine again keeps them.
  const rerunLevel = opts.directory ? ` --level ${MAX_LEVEL}` : level !== DEFAULT_LEVEL ? ` --level ${level}` : '';
  const named = opts.only ? opts.engines.filter((e) => opts.only!.includes(e.id)) : opts.engines;
  // Engines named by hand skip the level filter. A preset names engines too, but it keeps the filter.
  const byHand = opts.only !== undefined && opts.preset === undefined;
  const passes = (e: Engine): boolean => byHand || e.level <= level;
  const active = named.filter(passes);
  const leftOut = named.some((e) => !passes(e) && e.kinds.includes(target.kind));
  const now = opts.now ?? (() => new Date());
  const emit = opts.onEvent ?? (() => {});

  // A WordPress folder runs the install engines only. A theme or plugin inside it is tested by giving its own folder.
  const jobs = active.filter((e) => e.kinds.includes(target.kind));

  const startedAt = now().toISOString();
  emit({ type: 'run:start', target, jobs: jobs.map((engine) => ({ engine: engine.id })) });

  const engineRuns: EngineRun[] = [];
  const raw: Omit<Finding, 'id'>[] = [];
  // shortcut: engines run one at a time. Run them in parallel once real engines make a run slow.
  for (const engine of jobs) {
    if (opts.signal?.aborted) break;
    emit({ type: 'engine:start', engine: engine.id });
    const t0 = performance.now();
    let status: EngineRun['status'] = 'ok';
    let reason: string | undefined;
    let found: RawFinding[] = [];
    try {
      found = await engine.run({
        target,
        ...(opts.preset ? { preset: opts.preset } : {}),
        ...(opts.directory ? { directory: opts.directory } : {}),
        level,
        note: (message) => emit({ type: 'engine:note', engine: engine.id, message }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      if (err instanceof EngineSkipped) status = 'skipped';
      else status = 'failed';
      reason = err instanceof Error ? err.message : String(err);
    }
    const variant = engine.variant?.({ ...(opts.preset ? { preset: opts.preset } : {}), ...(opts.directory ? { directory: opts.directory } : {}), level });
    const er: EngineRun = {
      engine: engine.id,
      status,
      durationMs: Math.round(performance.now() - t0),
      findings: found.length,
      ...(reason !== undefined ? { reason } : {}),
      ...(variant !== undefined ? { variant } : {}),
    };
    engineRuns.push(er);
    for (const f of found) {
      const location = { ...f.location };
      if (location.file !== undefined) location.file = posix(relInside(target.path, location.file));
      raw.push({
        ...f,
        location,
        engine: engine.id,
        rerun: `wp-shakedown run "${target.path}" --engine ${engine.id}${rerunLevel}`,
      });
    }
    emit({ type: 'engine:end', run: er });
  }

  let findings: Finding[] = assignIds(raw).sort(compare);
  let staleBaseline: string[] = [];
  if (opts.baseline) {
    const applied = applyBaseline(findings, opts.baseline);
    findings = applied.findings;
    // An entry is only stale when every engine ran. After a partial run it may belong to an engine that did not.
    const complete = !opts.only && !leftOut && engineRuns.length === jobs.length && engineRuns.every((e) => e.status === 'ok');
    staleBaseline = complete ? applied.stale : [];
  }

  const summary: Summary = { error: 0, warning: 0, info: 0, suppressed: 0 };
  for (const f of findings) {
    if (f.suppressed) summary.suppressed++;
    else summary[f.severity]++;
  }

  const result: RunResult = {
    schema: 1,
    tool: { name: 'wp-shakedown', version: VERSION },
    target: {
      kind: target.kind,
      path: target.path,
      name: target.name,
      units: target.units.map((u) => ({ kind: u.kind, name: u.name, path: posix(path.relative(target.path, u.path)) })),
    },
    ...(opts.preset ? { preset: opts.preset } : {}),
    level,
    ...(opts.directory ? { directory: opts.directory } : {}),
    startedAt,
    finishedAt: now().toISOString(),
    engines: engineRuns,
    findings,
    summary,
    staleBaseline,
  };
  emit({ type: 'run:end', result });
  return result;
}

const RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };

export function exitCode(result: RunResult, failOn: Severity | 'never'): 0 | 1 | 2 {
  if (result.engines.some((e) => e.status === 'failed')) return 2;
  if (failOn !== 'never' && result.findings.some((f) => !f.suppressed && RANK[f.severity] >= RANK[failOn])) return 1;
  return 0;
}
