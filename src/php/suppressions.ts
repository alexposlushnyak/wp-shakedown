import type { RawFinding } from '../types.ts';

// A phpcs comment that names no sniffs, or names the escaping sniff or one of its parents, switches off EscapeOutput.
const ANNOTATION = /(?:\/\/|#|\/\*)\s*(phpcs:(?:ignore|disable)|@codingStandardsIgnore(?:Line|Start))\b([^\n]*)/;
const COVERS = /(^|[\s,])WordPress(\.Security(\.EscapeOutput(\.[A-Za-z]+)?)?)?(?=[\s,]|$)/;
const END = /phpcs:enable|@codingStandardsIgnoreEnd/;
const OUTPUT = /<\?=|\b(?:echo|print|printf|vprintf|_e|_ex|exit|die)\b/;

/** The escaping check is off for this comment: it lists no sniffs, or it lists EscapeOutput or a parent of it. */
function coversEscaping(rest: string): boolean {
  const list = rest.split('--')[0]!.replace(/\*\/.*$/, '').trim();
  return list === '' || COVERS.test(list);
}

/**
 * Findings for phpcs comments that hide unescaped output from WPCS. WPCS reports output it cannot see escaped,
 * even through wrapper functions, so a comment that silences it is the way unescaped output slips through.
 * A comment with a reason after `--` is a note, one without a reason is a warning.
 */
export function escapingSuppressed(file: string, text: string): RawFinding[] {
  const lines = text.split('\n');
  const out: RawFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ANNOTATION.exec(lines[i]!);
    if (!m || !coversEscaping(m[2]!)) continue;
    const block = m[1] === 'phpcs:disable' || m[1] === '@codingStandardsIgnoreStart';
    // An ignore on a line of its own covers the next line. A disable covers everything up to its enable.
    const code = lines[i]!.slice(0, m.index).trim();
    let covered: string[];
    if (block) {
      const end = lines.findIndex((l, j) => j > i && END.test(l));
      covered = lines.slice(i + 1, end < 0 ? lines.length : end);
    } else covered = [code === '' ? (lines[i + 1] ?? '') : code];
    if (!covered.some((l) => OUTPUT.test(l))) continue;
    const reason = m[2]!.includes('--') && m[2]!.split('--')[1]!.replace(/\*\/.*$/, '').trim() !== '';
    out.push({
      rule: 'escaping-suppressed',
      severity: reason ? 'info' : 'warning',
      category: 'security',
      message: reason ? 'A phpcs comment switches off the escaping check on output, with a reason.' : 'A phpcs comment switches off the escaping check on output, without a reason.',
      location: { file, line: i + 1 },
      hint: 'Escape the value with esc_html(), esc_attr(), esc_url() or wp_kses_post() and remove the comment. Keep the comment only for output that is escaped already, and give the reason after --.',
    });
  }
  return out;
}
