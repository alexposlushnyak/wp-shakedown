import { readFileSync } from 'node:fs';
import type { Baseline, Finding } from './types.ts';

export function loadBaseline(file: string): Baseline {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`Cannot read the baseline file "${file}".`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`The baseline file "${file}" is not valid JSON.`);
  }
  const b = data as { schema?: unknown; entries?: unknown } | null;
  if (!b || typeof b !== 'object' || b.schema !== 1 || !Array.isArray(b.entries)) {
    throw new Error(`The baseline file "${file}" must look like { "schema": 1, "entries": [] }.`);
  }
  b.entries.forEach((e: { id?: unknown; reason?: unknown } | null, i: number) => {
    if (typeof e?.id !== 'string') throw new Error(`Entry ${i + 1} in "${file}" has no id.`);
    if (typeof e.reason !== 'string' || !e.reason.trim()) {
      throw new Error(`Entry ${i + 1} in "${file}" has no reason. Every suppressed finding needs one.`);
    }
  });
  return data as Baseline;
}

export function applyBaseline(findings: Finding[], baseline: Baseline): { findings: Finding[]; stale: string[] } {
  const reasons = new Map(baseline.entries.map((e) => [e.id, e.reason]));
  const seen = new Set<string>();
  const out = findings.map((f) => {
    const reason = reasons.get(f.id);
    if (reason === undefined) return { ...f };
    seen.add(f.id);
    return { ...f, suppressed: { reason } };
  });
  return { findings: out, stale: baseline.entries.filter((e) => !seen.has(e.id)).map((e) => e.id) };
}
