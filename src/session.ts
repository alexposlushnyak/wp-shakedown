import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadBaseline } from './baseline.ts';
import { diffRuns } from './diff.ts';
import { assertReportDir, defaultReportDir, readPreviousRun, writeReports } from './report/write.ts';
import { findPreset, presetEngines } from './presets.ts';
import { customEngines } from './engines/custom.ts';
import { run } from './runner.ts';
import { detectTarget } from './target.ts';
import { DEFAULT_LEVEL } from './types.ts';
import type { Engine, RunDiff, RunEvent, RunResult } from './types.ts';

export interface SessionOptions {
  input: string;
  type?: 'theme' | 'plugin' | 'install';
  only?: string[];
  preset?: string;
  /** Old name of `preset`. */
  profile?: string;
  /** The level of the run. A preset with a level sets it when this is absent. */
  level?: number;
  /** Old name from the command line and MCP. It raises the level to at least 7. */
  experimental?: boolean;
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
  const preset = opts.preset ?? opts.profile;
  if (preset && opts.only) throw new Error('Use a preset or a list of engines, not both.');
  const all = [...opts.engines, ...customEngines(target)];
  const only = preset ? presetEngines(preset, target, all.map((e) => e.id)) : opts.only;
  const found = preset ? findPreset(preset) : undefined;
  let level = opts.level ?? found?.level;
  // The old --experimental flag asked for the reviewer rules of wordpress.org: level 7 with the wporg directory rules.
  if (opts.experimental) level = Math.max(level ?? DEFAULT_LEVEL, 7);
  const directory = found?.directory ?? (opts.experimental ? 'wporg' : undefined);
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
    engines: all,
    ...(only ? { only } : {}),
    ...(preset ? { preset } : {}),
    ...(directory ? { directory } : {}),
    ...(level !== undefined ? { level } : {}),
    ...(baseline ? { baseline } : {}),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  const diff = previous ? diffRuns(previous, result) : undefined;
  const files = writeReports(result, dir, diff);
  return { result, ...(diff ? { diff } : {}), files, dir };
}
