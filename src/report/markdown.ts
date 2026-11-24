import type { Finding, RunDiff, RunResult } from '../types.ts';

const oneLine = (s: string): string => s.replace(/\s*\r?\n\s*/g, ' ');
const cell = (s: string): string => oneLine(s).replace(/\|/g, '\\|');
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function summaryLine(result: RunResult): string {
  const s = result.summary;
  const base = `${plural(s.error, 'error', 'errors')}, ${plural(s.warning, 'warning', 'warnings')}, ${plural(s.info, 'note', 'notes')}.`;
  return s.suppressed > 0 ? `${base} ${s.suppressed} suppressed.` : base;
}

export function noEngineLine(result: RunResult): string {
  const label = { theme: 'theme', plugin: 'plugin', install: 'WordPress folder', url: 'site URL' }[result.target.kind];
  return `No engine ran. This version has no engine for a ${label} yet.`;
}

export function groupName(f: Finding): string {
  return f.location.file ?? f.location.url ?? '(no file)';
}

function findingText(f: Finding): string {
  const line = f.location.line !== undefined ? ` line ${f.location.line}` : '';
  return `${f.severity} \`${f.id}\`${line}: ${oneLine(f.message)} (${f.engine}: ${f.rule})`;
}

export function toMarkdown(result: RunResult, diff?: RunDiff): string {
  const out: string[] = [];
  out.push('# wp-shakedown report');
  out.push(
    `- Target: ${result.target.kind} "${result.target.name}" at ${result.target.path}${result.profile ? `\n- Profile: ${result.profile}` : ''}${result.depth && result.depth !== 'standard' ? `\n- Depth: ${result.depth}` : ''}\n- Run: ${result.finishedAt}, wp-shakedown ${result.tool.version}`,
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
    out.push('## Since the last run', `${diff.fixed.length} fixed, ${diff.added.length} new, ${diff.open.length} still open.`);
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
  const groups = new Map<string, Finding[]>();
  for (const f of detail) {
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
