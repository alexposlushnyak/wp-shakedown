import type { RunEvent } from './types.ts';

/** One line of progress for the terminal, or undefined when the event needs none. */
export function progressLine(e: RunEvent): string | undefined {
  if (e.type === 'engine:note') return `  ${e.engine}${e.unit ? ' ' + e.unit : ''}: ${e.message}`;
  if (e.type !== 'engine:end') return undefined;
  const r = e.run;
  const who = `${r.engine}${r.unit ? ' ' + r.unit : ''}`;
  if (r.status === 'ok') {
    return `ok ${who}: ${r.findings} ${r.findings === 1 ? 'finding' : 'findings'}, ${(r.durationMs / 1000).toFixed(1)}s`;
  }
  return `${r.status} ${who}: ${r.reason}`;
}
