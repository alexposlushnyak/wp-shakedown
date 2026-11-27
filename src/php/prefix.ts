// Names that WordPress core or PHP own, told apart by their first segment.
const CORE = /^(_|(wp|get|the|is|esc|admin|do)_)/;
const REFUSED = new Set(['wp', 'wordpress']);

/** The text with comments and string contents replaced by spaces, so offsets stay the same. */
function mask(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|#(?!\[)[^\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, (m) => {
    const blank = m.replace(/[^\n]/g, ' ');
    // Keep the quotes so a string argument is still recognisable.
    return m[0] === "'" || m[0] === '"' ? m[0] + blank.slice(1, -1) + m[0] : blank;
  });
}

function stringAt(text: string, quote: number): string | undefined {
  const q = text[quote]!;
  const end = text.indexOf(q, quote + 1);
  const s = end < 0 ? '' : text.slice(quote + 1, end);
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(s) ? s : undefined;
}

/**
 * Global names a PHP file declares: functions, classes and constants. Methods are skipped. Hook names stay out:
 * a theme fires hooks of other plugins, such as WooCommerce in its template overrides, and those would win.
 */
function names(text: string): string[] {
  const code = mask(text);
  const out: string[] = [];
  const classBraces = new Set<number>();
  for (const m of code.matchAll(/\b(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/g)) {
    // "A::class" and "new class" never match: a name must follow the keyword.
    if (code.slice(0, m.index).trimEnd().endsWith('::')) continue;
    const open = code.indexOf('{', m.index);
    if (open >= 0) classBraces.add(open);
    out.push(m[1]!);
  }
  const stack: boolean[] = [];
  const global = new Set<number>();
  const decl = /\bfunction\s+&?\s*([A-Za-z_]\w*)\s*\(|(?:^|[;{}\s])const\s+([A-Za-z_]\w*)\s*=/g;
  const positions: [number, string][] = [];
  for (const m of code.matchAll(decl)) positions.push([m.index, (m[1] ?? m[2])!]);
  let next = 0;
  for (let i = 0; i < code.length; i++) {
    while (next < positions.length && positions[next]![0] <= i) {
      if (!stack.some(Boolean)) global.add(next);
      next++;
    }
    const c = code[i];
    if (c === '{') stack.push(classBraces.has(i));
    else if (c === '}') stack.pop();
  }
  positions.forEach(([, n], i) => {
    if (global.has(i)) out.push(n);
  });
  for (const m of code.matchAll(/\bdefine\s*\(\s*(['"])/g)) {
    const s = stringAt(text, m.index + m[0].length - 1);
    if (s) out.push(s);
  }
  return out;
}

/**
 * The prefix most global names of a theme or plugin share, without the trailing underscore,
 * or undefined when no prefix covers 60% of at least three names.
 */
export function dominantPrefix(files: { path: string; text: string }[]): string | undefined {
  const all = new Set<string>();
  for (const f of files) {
    for (const n of names(f.text)) {
      const lower = n.toLowerCase();
      if (!CORE.test(lower)) all.add(lower);
    }
  }
  const counts = new Map<string, number>();
  for (const n of all) {
    const parts = n.split('_');
    for (let i = 1; i < parts.length; i++) {
      const p = parts.slice(0, i).join('_');
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  const need = Math.max(3, Math.ceil(all.size * 0.6));
  let best: string | undefined;
  for (const [p, n] of counts) {
    if (n < need || p.length < 3 || REFUSED.has(p) || !/[a-z0-9]/.test(p)) continue;
    if (!best || p.length > best.length) best = p;
  }
  return best;
}
