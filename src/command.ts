import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// The script a .cmd shim of npm runs, relative to the folder of the shim: "%~dp0\node_modules\npm\bin\npm-cli.js" or "%dp0%\node_modules\...".
const SHIM_SCRIPT = /%~?dp0%?\\([^"%\r\n]+?\.(?:c|m)?js)"/gi;

/**
 * The program and arguments that start `cmd`. On Windows a command installed by npm, such as npm itself,
 * Claude Code or Codex, is a .cmd file, and Node starts a .cmd file only through cmd.exe, whose quoting
 * would mangle arguments such as a JSON schema. So the script the shim wraps runs with this Node instead.
 * Elsewhere, and for a real .exe, the command runs as given.
 */
export function resolveCommand(
  cmd: string,
  args: string[],
  env: { platform?: NodeJS.Platform; path?: string } = {},
): [string, string[]] {
  const platform = env.platform ?? process.platform;
  if (platform !== 'win32' || /[\\/]/.test(cmd) || path.extname(cmd) !== '') return [cmd, args];
  for (const dir of (env.path ?? process.env.PATH ?? process.env.Path ?? '').split(';').filter(Boolean)) {
    if (existsSync(path.join(dir, `${cmd}.exe`)) || existsSync(path.join(dir, `${cmd}.com`))) return [cmd, args];
    const shim = path.join(dir, `${cmd}.cmd`);
    if (!existsSync(shim)) continue;
    // The last script is the one the shim runs: npm.cmd first runs npm-prefix.js to find the prefix, then npm-cli.js.
    const script = [...readFileSync(shim, 'utf8').matchAll(SHIM_SCRIPT)].pop()?.[1];
    if (script) return [process.execPath, [path.join(dir, script), ...args]];
  }
  return [cmd, args];
}
