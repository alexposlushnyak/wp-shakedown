import { exec, NotFound } from '../exec.ts';
import { EngineSkipped } from '../types.ts';

export function phpBinary(): string {
  return process.env.WP_SHAKEDOWN_PHP || 'php';
}

let cached: Promise<string> | undefined;

export function resetPhpCache(): void {
  cached = undefined;
}

async function detect(): Promise<string> {
  const missing = new EngineSkipped('PHP is not installed. Put php on your PATH or set WP_SHAKEDOWN_PHP to its path.');
  try {
    const r = await exec(phpBinary(), ['-r', 'echo PHP_VERSION;']);
    if (r.code !== 0) throw missing;
    return r.stdout.trim();
  } catch (err) {
    throw err instanceof NotFound ? missing : err;
  }
}

/** The PHP version, for example "8.4.25". Looked up once per process. */
export function phpVersion(): Promise<string> {
  return (cached ??= detect());
}
