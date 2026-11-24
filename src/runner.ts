import { statSync } from 'node:fs';
import path from 'node:path';
import { applyBaseline } from './baseline.ts';
import { assignIds } from './fingerprint.ts';
import { unitLabel } from './target.ts';
import { VERSION } from './version.ts';
import { EngineSkipped } from './types.ts';
import type {
  Baseline,
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
  baseline?: Baseline;
  signal?: AbortSignal;
  onEvent?: (e: RunEvent) => void;
  now?: () => Date;
}

interface Job {
  engine: Engine;
  target: Target;
  unit?: Target;
}

const posix = (p: string): string => p.split('\\').join('/');

/** An absolute path inside base becomes relative to it. Anything else stays as given. */
function relInside(base: string, p: string): string {
  if (!path.isAbsolute(p)) return p;
  const r = path.relative(base, p);
  return r === '' || r.startsWith('..') || path.isAbsolute(r) ? p : r;
}

function normaliseFile(file: string, job: Job, root: Target): string {
  if (job.unit) {
    const unitRel = path.relative(root.path, job.unit.path);
    // A one-file plugin: every finding points at the plugin file itself.
    if (statSync(job.unit.path, { throwIfNoEntry: false })?.isFile()) return posix(unitRel);
    return posix(path.join(unitRel, relInside(job.target.path, file)));
  }
  return posix(relInside(job.target.path, file));
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
  const active = opts.only ? opts.engines.filter((e) => opts.only!.includes(e.id)) : opts.engines;
  const now = opts.now ?? (() => new Date());
  const emit = opts.onEvent ?? (() => {});

  const jobs: Job[] = active.filter((e) => e.kinds.includes(target.kind)).map((engine) => ({ engine, target }));
  if (target.kind === 'install') {
    for (const unit of target.units) {
      for (const engine of active) if (engine.kinds.includes(unit.kind)) jobs.push({ engine, target: unit, unit });
    }
  }

  const startedAt = now().toISOString();
  emit({ type: 'run:start', target });

  const engineRuns: EngineRun[] = [];
  const raw: Omit<Finding, 'id'>[] = [];
  // shortcut: engines run one at a time. Run them in parallel once real engines make a run slow.
  for (const job of jobs) {
    if (opts.signal?.aborted) break;
    const unit = job.unit ? unitLabel(job.unit) : undefined;
    emit({ type: 'engine:start', engine: job.engine.id, ...(unit ? { unit } : {}) });
    const t0 = performance.now();
    let status: EngineRun['status'] = 'ok';
    let reason: string | undefined;
    let found: RawFinding[] = [];
    try {
      found = await job.engine.run({
        target: job.target,
        note: (message) => emit({ type: 'engine:note', engine: job.engine.id, ...(unit ? { unit } : {}), message }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      if (err instanceof EngineSkipped) status = 'skipped';
      else status = 'failed';
      reason = err instanceof Error ? err.message : String(err);
    }
    const er: EngineRun = {
      engine: job.engine.id,
      ...(unit ? { unit } : {}),
      status,
      durationMs: Math.round(performance.now() - t0),
      findings: found.length,
      ...(reason !== undefined ? { reason } : {}),
    };
    engineRuns.push(er);
    for (const f of found) {
      const location = { ...f.location };
      if (location.file !== undefined) location.file = normaliseFile(location.file, job, target);
      raw.push({
        ...f,
        location,
        engine: job.engine.id,
        ...(unit ? { unit } : {}),
        rerun: `wp-shakedown run "${target.path}" --engine ${job.engine.id}`,
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
    const complete = !opts.only && engineRuns.length === jobs.length && engineRuns.every((e) => e.status === 'ok');
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
