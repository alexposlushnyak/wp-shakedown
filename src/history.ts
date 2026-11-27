import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { toJson } from './report/json.ts';
import { readPreviousRun } from './report/write.ts';
import type { RunResult, Summary } from './types.ts';

// shortcut: the number is fixed. Make it a setting when someone needs more or fewer runs.
export const KEEP_RUNS = 20;

const RUN_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9-]+Z(-[0-9]+)?$/;

export interface RunEntry {
  run: string;
  finishedAt: string;
  summary: Summary;
  preset?: string;
  level?: number;
  /** Engines with status failed. */
  failed: number;
}

const runsDir = (dir: string): string => path.join(dir, 'runs');

function runIds(dir: string): string[] {
  try {
    return readdirSync(runsDir(dir), { withFileTypes: true })
      .filter((d) => d.isDirectory() && RUN_ID.test(d.name))
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function store(dir: string, result: RunResult): string {
  const base = result.finishedAt.replace(/[:.]/g, '-');
  mkdirSync(runsDir(dir), { recursive: true });
  let id = base;
  // mkdirSync without recursive fails when the folder exists, so two runs that finish at once never share one.
  for (let n = 2; ; n++) {
    try {
      mkdirSync(path.join(runsDir(dir), id));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      id = `${base}-${n}`;
    }
  }
  writeFileSync(path.join(runsDir(dir), id, 'report.json'), toJson(result));
  return id;
}

/** Writes the run into dir/runs and returns its id. The first call also keeps `previous`, the report an older version wrote. */
export function saveRun(dir: string, result: RunResult, previous?: RunResult): string {
  if (previous && runIds(dir).length === 0) store(dir, previous);
  const id = store(dir, result);
  for (const old of runIds(dir).slice(KEEP_RUNS)) rmSync(path.join(runsDir(dir), old), { recursive: true, force: true });
  return id;
}

/** Newest first. A folder without a readable report.json is skipped. */
// shortcut: parses every kept report.json in full, a few MB each on a theme with thousands of style findings. Write a summary file per run if listing gets slow.
export function listRuns(dir: string): RunEntry[] {
  const entries: RunEntry[] = [];
  for (const run of runIds(dir)) {
    const r = readPreviousRun(path.join(runsDir(dir), run));
    if (!r) continue;
    entries.push({
      run,
      finishedAt: r.finishedAt,
      summary: r.summary,
      ...(r.preset !== undefined ? { preset: r.preset } : {}),
      ...(r.level !== undefined ? { level: r.level } : {}),
      failed: r.engines.filter((e) => e.status === 'failed').length,
    });
  }
  return entries;
}

/** The id is checked before any path is built, so a request cannot reach outside dir/runs. */
export function readRun(dir: string, run: string): RunResult | undefined {
  if (!RUN_ID.test(run)) return undefined;
  return readPreviousRun(path.join(runsDir(dir), run));
}

/** `ref` is a number from the list (1 is the newest) or a run id. */
export function resolveRun(entries: RunEntry[], ref: string): RunEntry | undefined {
  if (/^[0-9]{1,4}$/.test(ref)) return entries[Number(ref) - 1];
  return entries.find((e) => e.run === ref);
}

/** The run right before `run`. */
export function previousOf(entries: RunEntry[], run: string): RunEntry | undefined {
  const i = entries.findIndex((e) => e.run === run);
  return i >= 0 ? entries[i + 1] : undefined;
}
