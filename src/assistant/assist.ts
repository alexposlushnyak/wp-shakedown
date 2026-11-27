import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listRuns } from '../history.ts';
import { findPreset } from '../presets.ts';
import { runLabel } from '../report/markdown.ts';
import { readPreviousRun } from '../report/write.ts';
import { SEVERITY_NAMES } from '../types.ts';
import type { AssistantAnswer, AssistantProvider, AssistantReport, Target } from '../types.ts';
import { ask as askProvider } from './providers.ts';

const LABELS: Record<AssistantProvider, string> = { claude: 'Claude Code', codex: 'Codex', api: 'Anthropic API' };

export function counts(answers: AssistantAnswer[]): { pass: number; fail: number; unsure: number } {
  return {
    pass: answers.filter((a) => a.verdict === 'pass').length,
    fail: answers.filter((a) => a.verdict === 'fail').length,
    unsure: answers.filter((a) => a.verdict === 'unsure').length,
  };
}

function toMd(report: AssistantReport, name: string, titles: Map<string, string>): string {
  const c = counts(report.answers);
  const out = [`# Assistant checks: ${name}`, '', `${LABELS[report.provider]}, ${runLabel(report.startedAt)}. ${c.pass} pass, ${c.fail} fail, ${c.unsure} unsure.`];
  for (const a of report.answers) {
    out.push('', `## ${titles.get(a.check) ?? a.check} (${a.verdict})`);
    if (a.error) out.push('', a.error);
    if (a.findings.length > 0) out.push('');
    for (const f of a.findings) {
      const where = f.file ? ` ${f.file}${f.line !== undefined ? `:${f.line}` : ''}:` : '';
      out.push(`- ${SEVERITY_NAMES[f.severity]}${where} ${f.message}`);
      if (f.fix) out.push(`  Fix: ${f.fix}`);
    }
  }
  return out.join('\n') + '\n';
}

/** Answers the assistant checks of the newest run in `dir` and writes assistant.json and assistant.md next to it. */
export async function runAssist(opts: {
  dir: string;
  target: Target;
  checks?: string[];
  onAnswer?: (a: AssistantAnswer, done: number, total: number) => void;
  signal?: AbortSignal;
  ask?: typeof askProvider;
}): Promise<{ report: AssistantReport; files: string[] }> {
  const run = readPreviousRun(opts.dir);
  if (!run) throw new Error('No report yet. Run the checks first.');
  const provider = run.preset !== undefined ? findPreset(run.preset)?.assistant : undefined;
  if (!provider) {
    throw new Error(
      'The last run used no preset that allows an assistant. Copy a preset, set its assistant to claude, codex or api, and run with it. The assistant sends the files of the project to that provider.',
    );
  }
  let tasks = run.assistant ?? [];
  if (opts.checks) {
    for (const id of opts.checks) if (!tasks.some((t) => t.id === id)) throw new Error(`No check "${id}" in the last run.`);
    tasks = tasks.filter((t) => opts.checks!.includes(t.id));
  }
  if (tasks.length === 0) throw new Error('The last run lists no checks for an assistant.');

  const ask = opts.ask ?? askProvider;
  const startedAt = new Date().toISOString();
  const answers: AssistantAnswer[] = [];
  for (const task of tasks) {
    const a = await ask(provider, task, opts.target, opts.signal);
    answers.push(a);
    opts.onAnswer?.(a, answers.length, tasks.length);
  }
  const report: AssistantReport = { schema: 1, run: run.finishedAt, provider, startedAt, finishedAt: new Date().toISOString(), answers };

  mkdirSync(opts.dir, { recursive: true });
  const json = path.join(opts.dir, 'assistant.json');
  const md = path.join(opts.dir, 'assistant.md');
  writeFileSync(json, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(md, toMd(report, opts.target.name, new Map(tasks.map((t) => [t.id, t.title]))));
  const newest = listRuns(opts.dir)[0];
  if (newest) copyFileSync(json, path.join(opts.dir, 'runs', newest.run, 'assistant.json'));
  return { report, files: [md, json] };
}
