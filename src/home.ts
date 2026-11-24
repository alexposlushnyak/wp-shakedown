import os from 'node:os';
import path from 'node:path';

/** The folder where wp-shakedown keeps reports and downloaded tools. */
export function home(): string {
  return process.env.WP_SHAKEDOWN_HOME || path.join(os.homedir(), '.wp-shakedown');
}
