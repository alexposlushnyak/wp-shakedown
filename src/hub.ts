import path from 'node:path';
import { summaryLine } from './report/markdown.ts';
import type { Project } from './projects.ts';
import { exitCode } from './runner.ts';
import { runSession } from './session.ts';
import type { SessionOptions } from './session.ts';
import type { RunEvent, RunResult, Severity } from './types.ts';

export interface HubRow {
  /** The target name once the run has started, the base name of the path before. */
  name: string;
  path: string;
  /** failed: the run itself threw. */
  state: 'waiting' | 'running' | 'done' | 'failed';
  /** Jobs of the run, 0 before it starts. */
  total: number;
  /** Engines finished so far. */
  done: number;
  /** "wpcs" or "wpcs theme:twentytwenty" while an engine runs. */
  current?: string;
  result?: RunResult;
  reportFile?: string;
  error?: string;
}

export interface HubOptions {
  jobs: number;
  session: Omit<SessionOptions, 'input' | 'onEvent'>;
  onChange?: (rows: HubRow[], changed: HubRow, event?: RunEvent) => void;
}

/** Runs the sessions with at most `jobs` at a time. One run that throws makes that row failed and nothing more. */
export async function runMany(inputs: string[], opts: HubOptions): Promise<HubRow[]> {
  const rows: HubRow[] = inputs.map((p) => ({ name: path.basename(path.resolve(p)), path: p, state: 'waiting', total: 0, done: 0 }));
  const change = (row: HubRow, event?: RunEvent): void => opts.onChange?.(rows, row, event);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < rows.length) {
      const i = next++;
      const row = rows[i]!;
      row.state = 'running';
      change(row);
      try {
        const s = await runSession({
          ...opts.session,
          input: inputs[i]!,
          onEvent: (e) => {
            if (e.type === 'run:start') {
              row.name = e.target.name;
              row.total = e.jobs.length;
            } else if (e.type === 'engine:start') {
              row.current = `${e.engine}${e.unit ? ' ' + e.unit : ''}`;
            } else if (e.type === 'engine:end') {
              row.done++;
              delete row.current;
            }
            change(row, e);
          },
        });
        row.state = 'done';
        row.result = s.result;
        row.name = s.result.target.name;
        if (s.files[0]) row.reportFile = s.files[0];
      } catch (err) {
        row.state = 'failed';
        row.error = err instanceof Error ? err.message : String(err);
      }
      delete row.current;
      change(row);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.jobs, rows.length)) }, worker));
  return rows;
}

/** One line per row for the live view. */
export function hubLines(rows: HubRow[], width: number): string[] {
  const pad = Math.max(0, ...rows.map((r) => r.name.length));
  return rows.map((r) => {
    const name = r.name.padEnd(pad);
    let text: string;
    if (r.state === 'waiting') text = `  ${name}  waiting`;
    else if (r.state === 'running') text = `  ${name}  ${r.done}/${r.total}${r.current ? '  ' + r.current : ''}`;
    else if (r.state === 'failed') text = `  ${name}  failed: ${r.error}`;
    else {
      const failed = r.result!.engines.filter((e) => e.status === 'failed').length;
      text = `  ${name}  ${summaryLine(r.result!)}${failed ? ` ${failed} ${failed === 1 ? 'engine' : 'engines'} failed.` : ''}`;
    }
    return text.slice(0, width);
  });
}

/** 2 when a run failed or any run's exit code is 2, else 1 when any is 1, else 0. */
export function hubExitCode(rows: HubRow[], failOn: Severity | 'never'): 0 | 1 | 2 {
  let code: 0 | 1 | 2 = 0;
  for (const r of rows) {
    const c = r.state === 'done' && r.result ? exitCode(r.result, failOn) : 2;
    if (c > code) code = c;
  }
  return code;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
function localTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** The groups of the project list, in the order the list and the page show them. */
export const PROJECT_GROUPS = [
  { kind: 'theme', title: 'Themes' },
  { kind: 'plugin', title: 'Plugins' },
  { kind: 'install', title: 'WordPress folders' },
  { kind: undefined, title: 'Cannot be tested' },
] as const;

/** The text table of the project list: a header row, then the projects under a title per group, columns padded with spaces. */
export function projectTable(projects: Project[]): string {
  const row = (p: Project): string[] => {
    const counts = p.last ? [p.last.summary.error, p.last.summary.warning, p.last.summary.info].map(String) : ['-', '-', '-'];
    const when = p.problem ?? (p.last ? localTime(p.last.finishedAt) : 'never');
    return [p.id, p.name, when, ...(p.problem ? ['-', '-', '-'] : counts), p.path];
  };
  const head = ['ID', 'Name', 'Last run', 'Errors', 'Warnings', 'Notes', 'Path'];
  // Any kind without a group of its own goes to the last one, so no project drops out of the list.
  const known: (string | undefined)[] = PROJECT_GROUPS.map((g) => g.kind).filter(Boolean);
  const fits = (p: Project, kind: string | undefined): boolean => (kind === undefined ? !known.includes(p.kind) : p.kind === kind);
  const groups = PROJECT_GROUPS.map((g) => ({ title: g.title, rows: projects.filter((p) => fits(p, g.kind)).map(row) })).filter((g) => g.rows.length > 0);
  const all = [head, ...groups.flatMap((g) => g.rows)];
  const widths = head.map((_, c) => Math.max(...all.map((r) => r[c]!.length)));
  const line = (r: string[]): string => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]!))).join('  ').trimEnd();
  return [line(head), ...groups.flatMap((g) => ['', g.title, ...g.rows.map(line)])].join('\n');
}
