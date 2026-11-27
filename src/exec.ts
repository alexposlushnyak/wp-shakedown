import { spawn } from 'node:child_process';
import { resolveCommand } from './command.ts';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Thrown when the command does not exist. */
export class NotFound extends Error {}

export function exec(cmd: string, args: string[], opts: { cwd?: string; signal?: AbortSignal; env?: Record<string, string> } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const [program, argv] = resolveCommand(cmd, args);
    const child = spawn(program, argv, {
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', (err: NodeJS.ErrnoException) => reject(err.code === 'ENOENT' ? new NotFound(`${cmd} was not found.`) : err));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
