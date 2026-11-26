import type { Finding, RunDiff, RunResult } from './types.ts';

const key = (engine: string, unit?: string): string => `${engine}\n${unit ?? ''}`;

/** What ran well, with the variant of the tool it ran. */
const ranOk = (r: RunResult): Map<string, string> =>
  new Map(r.engines.filter((e) => e.status === 'ok').map((e) => [key(e.engine, e.unit), e.variant ?? '']));

/**
 * Compares only what the same engine checked in both runs. A run with --engine,
 * or one where an engine was skipped, would otherwise report the findings of
 * every engine that did not run as fixed. The same goes for an engine that ran
 * another variant of its tool, such as Theme Check under the envato preset.
 */
export function diffRuns(previous: RunResult, current: RunResult): RunDiff {
  const before = ranOk(previous);
  const now = ranOk(current);
  const compared = (f: Finding): boolean => {
    const k = key(f.engine, f.unit);
    return !f.suppressed && before.has(k) && before.get(k) === now.get(k);
  };
  const prev = previous.findings.filter(compared);
  const cur = current.findings.filter(compared);
  const prevIds = new Set(prev.map((f) => f.id));
  const curIds = new Set(cur.map((f) => f.id));
  return {
    fixed: prev.filter((f) => !curIds.has(f.id)),
    added: cur.filter((f) => !prevIds.has(f.id)),
    open: cur.filter((f) => prevIds.has(f.id)),
  };
}
