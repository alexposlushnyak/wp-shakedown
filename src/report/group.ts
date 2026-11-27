import { SEVERITIES } from '../types.ts';
import type { Finding, Severity } from '../types.ts';

export interface RuleGroup {
  engine: string;
  rule: string;
  severity: Severity;
  findings: Finding[];
  /** Distinct files (or URLs) the findings sit in. Findings without one are not counted. */
  files: number;
}

/** A rule repeats when it has this many findings, in at least two files. */
export const REPEAT_MIN = 3;

export function groupName(f: Finding): string {
  return f.location.file ?? f.location.url ?? '(no file)';
}

const rank = (s: Severity): number => SEVERITIES.indexOf(s);

export function byRule(findings: Finding[]): RuleGroup[] {
  const map = new Map<string, RuleGroup>();
  for (const f of findings) {
    const key = `${f.engine}\0${f.rule}`;
    const g = map.get(key);
    if (g) {
      g.findings.push(f);
      if (rank(f.severity) < rank(g.severity)) g.severity = f.severity;
    } else {
      map.set(key, { engine: f.engine, rule: f.rule, severity: f.severity, findings: [f], files: 0 });
    }
  }
  const groups = [...map.values()];
  // Findings without a file or URL are in no file, so they do not count as one.
  for (const g of groups) g.files = new Set(g.findings.filter((f) => f.location.file || f.location.url).map(groupName)).size;
  const label = (g: RuleGroup): string => `${g.engine}: ${g.rule}`;
  return groups.sort(
    (a, b) => rank(a.severity) - rank(b.severity) || b.findings.length - a.findings.length || (label(a) < label(b) ? -1 : label(a) > label(b) ? 1 : 0),
  );
}

export function splitRepeated(findings: Finding[]): { repeated: RuleGroup[]; rest: Finding[] } {
  const repeated = byRule(findings).filter((g) => g.findings.length >= REPEAT_MIN && g.files >= 2);
  const taken = new Set(repeated.flatMap((g) => g.findings));
  return { repeated, rest: findings.filter((f) => !taken.has(f)) };
}
