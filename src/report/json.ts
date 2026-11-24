import type { RunResult } from '../types.ts';

export function toJson(result: RunResult): string {
  return JSON.stringify(result, null, 2) + '\n';
}
