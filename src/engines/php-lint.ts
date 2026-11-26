import { statSync } from 'node:fs';
import path from 'node:path';
import { phpFiles } from '../php/files.ts';
import { phpPath, phpVersion, runPhp, usesBundledPhp } from '../php/php.ts';
import type { Engine, RawFinding } from '../types.ts';

export function parseLint(output: string): { message: string; line?: number } | undefined {
  const m = /(?:PHP )?(?:Parse|Fatal) error:\s+(.+?) in .+ on line (\d+)/.exec(output);
  return m ? { message: m[1]!, line: Number(m[2]) } : undefined;
}

/**
 * Reads the output of one `php -l` call that checked several files.
 * Each file with a parse error gets its message and line. A file named in an
 * "Errors parsing" line without a message is mapped to undefined.
 */
export function parseLintBatch(output: string, files: string[]): Map<string, { message: string; line?: number } | undefined> {
  const out = new Map<string, { message: string; line?: number } | undefined>();
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    const m = /^(?:PHP )?(?:Parse|Fatal) error:\s+(.+) on line (\d+)$/.exec(line);
    if (m) {
      const file = files.find((f) => m[1]!.endsWith(` in ${f}`));
      if (file) out.set(file, { message: m[1]!.slice(0, -` in ${file}`.length), line: Number(m[2]) });
      continue;
    }
    const e = /^Errors parsing (.+)$/.exec(line);
    const failed = e && files.find((f) => f === e[1]);
    if (failed && !out.has(failed)) out.set(failed, undefined);
  }
  return out;
}

export const phpLint: Engine = {
  id: 'php-lint',
  title: 'PHP syntax',
  kinds: ['theme', 'plugin'],
  level: 0,
  async run({ target, signal, note }) {
    note(`Checking syntax with PHP ${await phpVersion(note)}.`);
    const targetPath = phpPath(target.path);
    const base = statSync(targetPath).isFile() ? path.dirname(targetPath) : targetPath;
    const files = phpFiles(target.path).map(phpPath);
    const findings: RawFinding[] = [];
    const add = (file: string, message: string, line?: number): void => {
      findings.push({
        rule: 'syntax',
        severity: 'error',
        category: 'correctness',
        message,
        location: { file: path.relative(base, file).split(path.sep).join('/'), ...(line ? { line } : {}) },
      });
    };
    const sorted = (): RawFinding[] => findings.sort((a, b) => (a.location.file! < b.location.file! ? -1 : a.location.file! > b.location.file! ? 1 : 0));
    if (usesBundledPhp()) {
      // Every PHP call boots a WebAssembly runtime, so one call checks many files.
      for (let i = 0; i < files.length && !signal?.aborted; i += 100) {
        const batch = files.slice(i, i + 100);
        const r = await runPhp(['-d', 'display_errors=1', '-d', 'log_errors=0', '-l', ...batch], { note, ...(signal ? { signal } : {}) });
        if (r.code === 0) continue;
        const out = `${r.stdout}\n${r.stderr}`;
        const first = out.split('\n').map((l) => l.trim()).find(Boolean);
        for (const [file, parsed] of parseLintBatch(out, batch)) add(file, parsed?.message ?? first ?? 'PHP could not parse this file.', parsed?.line);
      }
      return sorted();
    }
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < files.length && !signal?.aborted) {
        const file = files[next++]!;
        const r = await runPhp(['-d', 'display_errors=1', '-d', 'log_errors=0', '-l', file], { note, ...(signal ? { signal } : {}) });
        if (r.code === 0) continue;
        const out = `${r.stdout}\n${r.stderr}`;
        const parsed = parseLint(out);
        const first = out.split('\n').map((l) => l.trim()).find(Boolean);
        add(file, parsed?.message ?? first ?? 'PHP could not parse this file.', parsed?.line);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
    return sorted();
  },
};
