import { createHash } from 'node:crypto';
import type { Location } from './types.ts';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12);

export function assignIds<T extends { engine: string; unit?: string; rule: string; message: string; location: Location }>(
  items: T[],
): (T & { id: string })[] {
  const groups = new Map<string, number[]>();
  items.forEach((f, i) => {
    const key = JSON.stringify([
      f.engine,
      f.rule,
      f.unit ?? '',
      f.location.file ?? f.location.url ?? '',
      f.location.selector ?? '',
      f.message,
    ]);
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  });
  const ids: string[] = [];
  for (const [key, idx] of groups) {
    idx.sort(
      (a, b) =>
        (items[a]!.location.line ?? 0) - (items[b]!.location.line ?? 0) ||
        (items[a]!.location.column ?? 0) - (items[b]!.location.column ?? 0),
    );
    idx.forEach((i, n) => {
      ids[i] = n === 0 ? sha(key) : sha(`${key}#${n + 1}`);
    });
  }
  return items.map((f, i) => ({ ...f, id: ids[i]! }));
}
