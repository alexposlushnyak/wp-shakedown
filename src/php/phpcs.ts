import { statSync } from 'node:fs';
import path from 'node:path';
import type { Target } from '../types.ts';
import { phpPath, phpVersion, runPhp, usesBundledPhp } from './php.ts';
import { phpTools } from './tools.ts';

export interface PhpcsMessage {
  file: string;
  line: number;
  column: number;
  source: string;
  message: string;
  type: 'ERROR' | 'WARNING';
  fixable: boolean;
}

export function parsePhpcs(json: string): PhpcsMessage[] {
  const bad = new Error('PHPCS returned output that is not JSON.');
  let data: { files?: Record<string, { messages?: Omit<PhpcsMessage, 'file'>[] }> };
  try {
    data = JSON.parse(json);
  } catch {
    throw bad;
  }
  if (!data || typeof data.files !== 'object' || data.files === null) throw bad;
  const out: PhpcsMessage[] = [];
  for (const [file, f] of Object.entries(data.files)) {
    for (const m of f.messages ?? []) {
      out.push({ file, line: m.line, column: m.column, source: m.source, message: m.message, type: m.type, fixable: m.fixable });
    }
  }
  return out;
}

/**
 * PHPCS matches --ignore against the absolute path, so a plain vendor pattern
 * would drop every file of a target that itself sits below a vendor folder.
 * The pattern is a regular expression anchored to the target. PHPCS turns a
 * star into ".*" and splits on commas, so neither may appear unescaped.
 */
export function ignorePattern(base: string): string {
  const escaped = base.split(path.sep).join('/').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/,/g, '\\,');
  return `^${escaped}/(.+/)?(vendor|node_modules)/`;
}

const firstLine = (s: string): string => s.split('\n').map((l) => l.trim()).find(Boolean) ?? '';

export async function runPhpcs(opts: {
  target: Target;
  standard: string | ((tools: string) => string);
  extra?: string[];
  signal?: AbortSignal;
  note: (m: string) => void;
}): Promise<PhpcsMessage[]> {
  await phpVersion(opts.note);
  const tools = await phpTools(opts.note);
  const targetPath = phpPath(opts.target.path);
  const isFile = statSync(targetPath).isFile();
  const base = isFile ? path.dirname(targetPath) : targetPath;
  const args = [
    '-d', 'memory_limit=1G',
    path.join(tools, 'vendor', 'bin', 'phpcs'),
    '--report=json', '-q', '--no-colors', '--extensions=php',
    ...(isFile ? [] : [`--ignore=${ignorePattern(base)}`]),
    `--basepath=${base}`,
    `--standard=${typeof opts.standard === 'function' ? opts.standard(tools) : opts.standard}`,
    // Generic.PHP.Syntax starts one PHP per file, which is far slower in the bundled PHP. php-lint reports syntax errors.
    ...(usesBundledPhp() ? ['--exclude=Generic.PHP.Syntax'] : []),
    ...(opts.extra ?? []),
    targetPath,
  ];
  const r = await runPhp(args, { cwd: base, note: opts.note, ...(opts.signal ? { signal: opts.signal } : {}) });
  if (r.code > 2) throw new Error(`PHPCS stopped: ${firstLine(r.stdout) || firstLine(r.stderr)}`);
  return parsePhpcs(r.stdout);
}
