import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { home } from '../home.ts';
import type { RunDiff, RunResult, Target } from '../types.ts';
import { toHtml } from './html.ts';
import { toJson } from './json.ts';
import { toMarkdown } from './markdown.ts';
import { toSarif } from './sarif.ts';

export function defaultReportDir(target: Target): string {
  const slug = target.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'target';
  const hash = createHash('sha256').update(target.path).digest('hex').slice(0, 8);
  return path.join(home(), 'reports', `${slug}-${hash}`);
}

export function readPreviousRun(dir: string): RunResult | undefined {
  try {
    const data = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8')) as RunResult | null;
    return data?.schema === 1 && Array.isArray(data.findings) && Array.isArray(data.engines) ? data : undefined;
  } catch {
    return undefined;
  }
}

/** Throws when the report folder is the target or inside it. Call it before a run, so a long run is not wasted. */
export function assertReportDir(target: { kind: string; path: string }, dir: string): void {
  if (target.kind === 'url') return;
  // shortcut: compares the paths as given. A symlink that points into the target passes. Resolve real paths if that happens.
  const rel = path.relative(target.path, path.resolve(dir));
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error(
      `The report folder "${dir}" is inside the target. wp-shakedown never writes into what it tests. Pass --out with a folder elsewhere.`,
    );
  }
}

export function writeReports(result: RunResult, dir: string, diff?: RunDiff): string[] {
  assertReportDir(result.target, dir);
  const out = path.resolve(dir);
  mkdirSync(out, { recursive: true });
  const files: [string, string][] = [
    ['report.md', toMarkdown(result, diff)],
    ['report.json', toJson(result)],
    ['report.sarif', toSarif(result)],
    ['report.html', toHtml(result, diff)],
  ];
  return files.map(([name, text]) => {
    const p = path.join(out, name);
    writeFileSync(p, text);
    return p;
  });
}
