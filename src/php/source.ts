// Reading PHP text without a parser: what the review rules share.

/** Index after the quoted string that starts at `i`. */
export function endOfString(s: string, i: number): number {
  const q = s[i]!;
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') j++;
    else if (s[j] === q) return j + 1;
  }
  return s.length;
}

/** Replaces PHP comments with spaces and keeps newlines and strings, so line numbers stay right. */
export function stripComments(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const c = s[i]!;
    const two = s.slice(i, i + 2);
    if (c === '"' || c === "'") {
      const end = endOfString(s, i);
      out += s.slice(i, end);
      i = end;
    } else if (two === '/*' || two === '//' || (c === '#' && s[i + 1] !== '[')) {
      let end: number;
      if (two === '/*') end = s.indexOf('*/', i + 2) < 0 ? s.length : s.indexOf('*/', i + 2) + 2;
      else {
        // A line comment ends at a newline or at a closing PHP tag.
        const m = /\r?\n|\?>/.exec(s.slice(i));
        end = m ? i + m.index : s.length;
      }
      out += s.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Index of the bracket that closes the one at `i`, or -1. Strings do not count. */
export function close(s: string, i: number): number {
  const open = s[i]!;
  const end = open === '(' ? ')' : '}';
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j]!;
    if (c === '"' || c === "'") j = endOfString(s, j) - 1;
    else if (c === open) depth++;
    else if (c === end && --depth === 0) return j;
  }
  return -1;
}

/** The text a conditional runs: a brace block, an alternative-syntax block or the next statement. */
export function body(s: string, from: number): string {
  const m = /^\s*/.exec(s.slice(from))!;
  const i = from + m[0].length;
  if (s[i] === '{') {
    const end = close(s, i);
    return s.slice(i + 1, end < 0 ? s.length : end);
  }
  if (s[i] === ':') {
    const m2 = /\b(?:elseif|else|endif)\b/.exec(s.slice(i));
    return s.slice(i + 1, m2 ? i + m2.index : s.length);
  }
  let j = i;
  while (j < s.length && s[j] !== ';') {
    if (s[j] === '"' || s[j] === "'") j = endOfString(s, j);
    else j++;
  }
  return s.slice(i, j);
}
