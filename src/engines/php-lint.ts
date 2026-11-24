import { statSync } from 'node:fs';
import path from 'node:path';
import { exec } from '../exec.ts';
import { phpFiles } from '../php/files.ts';
import { phpBinary, phpVersion } from '../php/php.ts';
import type { Engine, RawFinding } from '../types.ts';

export function parseLint(output: string): { message: string; line?: number } | undefined {
  const m = /(?:PHP )?(?:Parse|Fatal) error:\s+(.+?) in .+ on line (\d+)/.exec(output);
  return m ? { message: m[1]!, line: Number(m[2]) } : undefined;
}

export const phpLint: Engine = {
  id: 'php-lint',
  title: 'PHP syntax',
  kinds: ['theme', 'plugin'],
  async run({ target, signal, note }) {
    note(`Checking syntax with PHP ${await phpVersion()}.`);
    const base = statSync(target.path).isFile() ? path.dirname(target.path) : target.path;
    const files = phpFiles(target.path);
    const findings: RawFinding[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < files.length && !signal?.aborted) {
        const file = files[next++]!;
        const r = await exec(phpBinary(), ['-d', 'display_errors=1', '-d', 'log_errors=0', '-l', file], { ...(signal ? { signal } : {}) });
        if (r.code === 0) continue;
        const out = `${r.stdout}\n${r.stderr}`;
        const parsed = parseLint(out);
        const first = out.split('\n').map((l) => l.trim()).find(Boolean);
        findings.push({
          rule: 'syntax',
          severity: 'error',
          category: 'correctness',
          message: parsed?.message ?? first ?? 'PHP could not parse this file.',
          location: { file: path.relative(base, file).split(path.sep).join('/'), ...(parsed?.line ? { line: parsed.line } : {}) },
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
    return findings.sort((a, b) => (a.location.file! < b.location.file! ? -1 : a.location.file! > b.location.file! ? 1 : 0));
  },
};
