import { SEVERITY_NAMES } from '../types.ts';
import type { RunResult } from '../types.ts';

const HEADER = ['id', 'severity', 'category', 'engine', 'rule', 'file', 'line', 'column', 'url', 'message', 'hint', 'docs', 'suppressed'];

/** RFC 4180 quoting, plus a leading quote on anything a spreadsheet would run as a formula. The messages come from the code under test. */
function field(value: string | number | undefined): string {
  let s = value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(result: RunResult): string {
  const rows = result.findings.map((f) =>
    [
      f.id,
      SEVERITY_NAMES[f.severity],
      f.category,
      f.engine,
      f.rule,
      f.location.file,
      f.location.line,
      f.location.column,
      f.location.url,
      f.message,
      f.hint,
      f.docs,
      f.suppressed?.reason,
    ].map(field).join(','),
  );
  return [HEADER.join(','), ...rows].join('\r\n') + '\r\n';
}
