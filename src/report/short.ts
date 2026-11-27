import type { Finding, RunDiff, RunResult } from '../types.ts';
import { DEFAULT_LEVEL, SEVERITY_NAMES } from '../types.ts';
import { byRule, groupName } from './group.ts';
import { kindLabel, levelLabel, noEngineLine, plural, runLabel, summaryLine } from './markdown.ts';

const oneLine = (s: string): string => s.replace(/\s*\r?\n\s*/g, ' ');
const MAX_PLACES = 5;

/** A quick look for a person, a pull request comment or a chat. The full report is report.md. */
export function toShort(result: RunResult, diff?: RunDiff, since?: string): string {
  const t = result.target;
  const out: string[] = [`# wp-shakedown: ${t.name}`];
  out.push(
    `${kindLabel(t.kind)} at ${t.path}, level ${levelLabel(result.level ?? DEFAULT_LEVEL)}${result.preset ? `, preset ${result.preset}` : ''}\nRun ${runLabel(result.finishedAt)}, wp-shakedown ${result.tool.version}.`,
  );

  const status = [summaryLine(result)];
  if (diff) {
    status.push(`${diff.fixed.length} fixed, ${diff.added.length} new, ${diff.open.length} still open ${since ? `since the run of ${runLabel(since)}` : 'since the last run'}.`);
  }
  out.push(status.join(' '));

  if (result.engines.length === 0) out.push(noEngineLine(result));
  else {
    const bad = result.engines.filter((e) => e.status !== 'ok');
    if (bad.length) out.push(bad.map((e) => `- ${e.engine} ${e.status}${e.reason ? `: ${oneLine(e.reason)}` : ''}`).join('\n'));
  }

  const active = result.findings.filter((f) => !f.suppressed);
  // Style findings stay counted below, as in report.md, even the few above Recommended.
  const urgent = byRule(active.filter((f) => f.severity !== 'info' && f.category !== 'standards'));
  out.push('## Critical and important');
  if (urgent.length === 0) out.push('No critical or important findings.');
  for (const g of urgent) {
    const where = (f: Finding): string | undefined =>
      f.location.file || f.location.url ? `${groupName(f)}${f.location.line !== undefined ? `:${f.location.line}` : ''}` : undefined;
    // One rule can carry different messages, as Theme Check does. Then each place gets its own message.
    const same = g.findings.every((f) => f.message === g.findings[0]!.message);
    const count = `${g.findings.length}${g.files ? ` in ${plural(g.files, 'file', 'files')}` : ''}`;
    const lines = [`- ${SEVERITY_NAMES[g.severity]} ${g.engine}: ${g.rule}, ${count}.${same ? ` ${oneLine(g.findings[0]!.message)}` : ''}`];
    const places = g.findings.map((f) => (same ? where(f) : [where(f), oneLine(f.message)].filter(Boolean).join(': '))).filter((p) => p !== undefined);
    for (const p of places.slice(0, MAX_PLACES)) lines.push(`  - ${p}`);
    if (places.length > MAX_PLACES) lines.push(`  - and ${places.length - MAX_PLACES} more`);
    out.push(lines.join('\n'));
  }

  if (result.assistant?.length) out.push(`${plural(result.assistant.length, 'check', 'checks')} for an assistant ${result.assistant.length === 1 ? 'is' : 'are'} in report.md.`);
  const style = active.filter((f) => f.category === 'standards').length;
  const recommended = active.filter((f) => f.severity === 'info' && f.category !== 'standards').length;
  if (recommended + style > 0) {
    out.push(`${plural(recommended, 'recommended finding', 'recommended findings')} and ${plural(style, 'code style finding', 'code style findings')} are in report.md.`);
  }
  return out.join('\n\n') + '\n';
}
