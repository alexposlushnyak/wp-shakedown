import { LEVEL_NAMES, SEVERITY_NAMES } from '../types.ts';
import type { Finding, RunDiff, RunResult } from '../types.ts';
import { groupName, splitRepeated } from './group.ts';
import type { RuleGroup } from './group.ts';

export { groupName };

const oneLine = (s: string): string => s.replace(/\s*\r?\n\s*/g, ' ');
const cell = (s: string): string => oneLine(s).replace(/\|/g, '\\|');
export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The level with its name where it has one: `6 (standard)` or `7`. */
export function levelLabel(level: number): string {
  const name = Object.entries(LEVEL_NAMES).find(([, n]) => n === level)?.[0];
  return name ? `${level} (${name})` : String(level);
}

export function summaryLine(result: RunResult): string {
  const s = result.summary;
  const base = `${s.error} critical, ${s.warning} important, ${s.info} recommended.`;
  return s.suppressed > 0 ? `${base} ${s.suppressed} suppressed.` : base;
}

/** The kind of a target in words people read. */
export function kindLabel(kind: RunResult['target']['kind']): string {
  return { theme: 'theme', plugin: 'plugin', install: 'WordPress folder', url: 'site URL' }[kind];
}

export function noEngineLine(result: RunResult): string {
  return `No engine ran. This version has no engine for a ${kindLabel(result.target.kind)} yet.`;
}

/** `2026-11-27 10:41 UTC`. An ISO string that is not a date comes back unchanged. */
export function runLabel(iso: string): string {
  return Number.isNaN(Date.parse(iso)) ? iso : `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

/** Markdown for a rule that repeats across files: one heading, the fix once, then every place. */
function repeatedBlock(g: RuleGroup): string[] {
  const first = (key: 'hint' | 'docs'): string | undefined => g.findings.find((f) => f[key])?.[key];
  const hint = first('hint');
  const docs = first('docs');
  const head = [`${SEVERITY_NAMES[g.severity]}. ${plural(g.findings.length, 'finding', 'findings')} in ${plural(g.files, 'file', 'files')}.`];
  if (hint) head.push(`Fix: ${oneLine(hint)}`);
  if (docs) head.push(`Docs: ${oneLine(docs)}`);
  const items = g.findings.map(
    (f) => `- ${groupName(f)}${f.location.line !== undefined ? ` line ${f.location.line}` : ''}: ${oneLine(f.message)} \`${f.id}\``,
  );
  return [`### ${g.engine}: ${g.rule}`, head.join('\n\n'), items.join('\n')];
}

function findingText(f: Finding): string {
  const line = f.location.line !== undefined ? ` line ${f.location.line}` : '';
  return `${SEVERITY_NAMES[f.severity]} \`${f.id}\`${line}: ${oneLine(f.message)} (${f.engine}: ${f.rule})`;
}

export function toMarkdown(result: RunResult, diff?: RunDiff, since?: string): string {
  const out: string[] = [];
  out.push('# wp-shakedown report');
  out.push(
    `- Target: ${result.target.kind} "${result.target.name}" at ${result.target.path}${result.preset ? `\n- Preset: ${result.preset}` : ''}${result.level !== undefined ? `\n- Level: ${levelLabel(result.level)}` : ''}${result.experimental ? '\n- Experimental checks: on' : ''}\n- Run: ${result.finishedAt}, wp-shakedown ${result.tool.version}`,
  );

  const summary = ['## Summary', summaryLine(result)];
  if (result.engines.length === 0) {
    summary.push(noEngineLine(result));
  } else {
    const rows = result.engines.map(
      (e) =>
        `| ${cell(e.engine)} | ${cell(e.unit ?? '-')} | ${e.status}${e.reason ? cell(`: ${e.reason}`) : ''} | ${e.findings} |`,
    );
    summary.push(['| Engine | Part | Status | Findings |', '|---|---|---|---|', ...rows].join('\n'));
  }
  out.push(...summary);

  if (diff) {
    out.push(since ? `## Since the run of ${runLabel(since)}` : '## Since the last run', `${diff.fixed.length} fixed, ${diff.added.length} new, ${diff.open.length} still open.`);
    const list = (title: string, all: Finding[]): void => {
      const items = all.filter((f) => f.category !== 'standards');
      if (items.length) out.push(`${title}\n\n${items.map((f) => `- ${groupName(f)}: ${findingText(f)}`).join('\n')}`);
    };
    list('New:', diff.added);
    list('Fixed:', diff.fixed);
  }

  out.push('## Findings');
  const active = result.findings.filter((f) => !f.suppressed);
  // A real theme has thousands of style findings. Listed one by one they bury the few that matter, so they are counted per rule below.
  const detail = active.filter((f) => f.category !== 'standards');
  const style = active.filter((f) => f.category === 'standards');
  if (active.length === 0) out.push('No findings.');
  else if (detail.length === 0) out.push('No findings apart from code style.');
  const { repeated, rest } = splitRepeated(detail);
  for (const g of repeated) out.push(...repeatedBlock(g));
  const groups = new Map<string, Finding[]>();
  for (const f of rest) {
    const g = groups.get(groupName(f));
    if (g) g.push(f);
    else groups.set(groupName(f), [f]);
  }
  for (const [name, items] of groups) {
    const lines = items.map((f) => {
      let s = `- ${findingText(f)}`;
      if (f.hint) s += `\n  Fix: ${oneLine(f.hint)}`;
      if (f.docs) s += `\n  Docs: ${oneLine(f.docs)}`;
      return s;
    });
    out.push(`### ${name}`, lines.join('\n'));
  }

  if (style.length) {
    const counts = new Map<string, number>();
    for (const f of style) counts.set(`${f.engine}: ${f.rule}`, (counts.get(`${f.engine}: ${f.rule}`) ?? 0) + 1);
    const rows = [...counts]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([rule, n]) => `| ${cell(rule)} | ${n} |`);
    out.push(
      '## Code style',
      `${plural(style.length, 'style finding', 'style findings')} in ${plural(counts.size, 'rule', 'rules')}. report.json lists each one with its file and line.`,
      ['| Rule | Findings |', '|---|---|', ...rows].join('\n'),
    );
  }

  if (result.assistant?.length) {
    out.push(
      '## For an assistant',
      'No tool can check these from the files. Give each one to an AI assistant, or run wp-shakedown assist with a preset that allows one.',
    );
    for (const a of result.assistant) {
      out.push(`### ${a.title}`, a.prompt);
      if (a.files.length) out.push(`Start with: ${a.files.join(', ')}`);
      if (a.docs) out.push(`Docs: ${a.docs}`);
    }
  }

  const suppressed = result.findings.filter((f) => f.suppressed);
  if (suppressed.length) {
    out.push(
      '## Suppressed',
      suppressed.map((f) => `- \`${f.id}\` ${f.engine}: ${f.rule}. Reason: ${oneLine(f.suppressed!.reason)}`).join('\n'),
    );
  }

  if (result.staleBaseline.length) {
    out.push(
      '## Stale baseline entries',
      'These baseline entries match nothing now. Remove them.',
      result.staleBaseline.map((id) => `- \`${id}\``).join('\n'),
    );
  }

  if (result.engines.length) {
    const ids = [...new Set(result.engines.map((e) => e.engine))];
    out.push('## Run again', ids.map((id) => `- \`wp-shakedown run "${result.target.path}" --engine ${id}\``).join('\n'));
  }

  return out.join('\n\n') + '\n';
}
