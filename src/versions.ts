const isNum = (s: string): boolean => /^\d+$/.test(s);

/** Negative, zero or positive. A numeric part beats a text part, so 1.0-beta is older than 1.0. */
export function compareVersions(a: string, b: string): number {
  const x = a.trim().toLowerCase().split(/[.\-+_]/);
  const y = b.trim().toLowerCase().split(/[.\-+_]/);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? '0';
    const q = y[i] ?? '0';
    if (isNum(p) && isNum(q)) {
      if (Number(p) !== Number(q)) return Number(p) - Number(q);
    } else if (isNum(p) !== isNum(q)) {
      return isNum(p) ? 1 : -1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}

export interface VersionRange {
  min?: string | null;
  minInclusive?: boolean;
  max?: string | null;
  maxInclusive?: boolean;
}

const bound = (v: string | null | undefined): v is string => !!v && v !== '*';

export function inRange(version: string, r: VersionRange): boolean {
  if (bound(r.min)) {
    const c = compareVersions(version, r.min);
    if (c < 0 || (c === 0 && !r.minInclusive)) return false;
  }
  if (bound(r.max)) {
    const c = compareVersions(version, r.max);
    if (c > 0 || (c === 0 && !r.maxInclusive)) return false;
  }
  return true;
}
