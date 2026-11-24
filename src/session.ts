import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadBaseline } from './baseline.ts';
import { diffRuns } from './diff.ts';
import { assertReportDir, defaultReportDir, readPreviousRun, writeReports } from './report/write.ts';
import { profileEngines } from './profiles.ts';
import { run } from './runner.ts';
import { detectTarget } from './target.ts';
import type { Engine, RunDiff, RunEvent, RunResult } from './types.ts';

export interface SessionOptions {
  input: string;
  type?: 'theme' | 'plugin' | 'install';
  only?: string[];
  profile?: string;
  out?: string;
  baselineFile?: string;
  engines: Engine[];
  onEvent?: (e: RunEvent) => void;
  signal?: AbortSignal;
}

export interface SessionResult {
  result: RunResult;
  diff?: RunDiff;
  files: string[];
  dir: string;
}

/** The steps from a path to written reports. The command line and the local server share them. */
export async function runSession(opts: SessionOptions): Promise<SessionResult> {
  const target = detectTarget(opts.input, opts.type ? { type: opts.type } : {});
  if (opts.profile && opts.only) throw new Error('Use a profile or a list of engines, not both.');
  const only = opts.profile ? profileEngines(opts.profile, target) : opts.only;
  let baselineFile = opts.baselineFile;
  if (!baselineFile && target.kind !== 'url') {
    const candidate = path.join(target.path, 'wp-shakedown-baseline.json');
    if (existsSync(candidate)) baselineFile = candidate;
  }
  const baseline = baselineFile ? loadBaseline(baselineFile) : undefined;
  const dir = opts.out ?? defaultReportDir(target);
  assertReportDir(target, dir);
  const previous = readPreviousRun(dir);
  const result = await run(target, {
    engines: opts.engines,
    ...(only ? { only } : {}),
    ...(opts.profile ? { profile: opts.profile } : {}),
    ...(baseline ? { baseline } : {}),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  const diff = previous ? diffRuns(previous, result) : undefined;
  const files = writeReports(result, dir, diff);
  return { result, ...(diff ? { diff } : {}), files, dir };
}
