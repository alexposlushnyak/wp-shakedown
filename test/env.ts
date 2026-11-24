import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const testHome = path.join(root, '.cache', 'wp-shakedown');
process.env.WP_SHAKEDOWN_HOME = testHome;
