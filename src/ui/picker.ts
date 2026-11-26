import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from '../exec.ts';

/** How to open the folder dialog of the system, and how to read its answer. */
export interface PickerCommand {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  /** The chosen folder, or null when the user closed the dialog. Throws on any other failure. */
  parse(code: number, stdout: string, stderr: string): string | null;
}

const PROMPT = 'Choose a theme, a plugin or a WordPress folder';

const MAC_SCRIPT = [
  'on run argv',
  'activate',
  `POSIX path of (choose folder with prompt "${PROMPT}" default location (POSIX file (item 1 of argv)))`,
  'end run',
];

// The start folder comes in through the environment, so no path is ever pasted into the script.
const WINDOWS_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
  `$d.Description = '${PROMPT}'`,
  '$d.ShowNewFolderButton = $false',
  '$d.SelectedPath = $env:WP_SHAKEDOWN_PICK_START',
  '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }',
  "if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }",
].join('; ');

function onPath(name: string, env: NodeJS.ProcessEnv): boolean {
  return (env.PATH ?? '').split(path.delimiter).some((dir) => dir !== '' && existsSync(path.join(dir, name)));
}

function clean(out: string): string {
  const p = out.trim();
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

/** Exit code 1 with no output is how zenity, kdialog and osascript report a closed dialog. */
function closedOr(code: number, stdout: string, stderr: string, closed: (stderr: string) => boolean): string | null {
  if (code === 0 && stdout.trim() !== '') return clean(stdout);
  if (code === 1 && closed(stderr)) return null;
  throw new Error(`The folder dialog failed: ${stderr.trim() || `exit code ${code}`}.`);
}

/** The command for this system, or undefined when it has no folder dialog the tool can open. */
export function pickerCommand(start: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): PickerCommand | undefined {
  if (platform === 'darwin') {
    return {
      cmd: 'osascript',
      args: [...MAC_SCRIPT.flatMap((line) => ['-e', line]), start],
      // -128 is AppleScript's "User canceled".
      parse: (code, out, err) => closedOr(code, out, err, (e) => e.includes('-128')),
    };
  }
  if (platform === 'win32') {
    return {
      cmd: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_SCRIPT],
      env: { WP_SHAKEDOWN_PICK_START: start },
      parse: (code, out, err) => {
        if (code !== 0) throw new Error(`The folder dialog failed: ${err.trim() || `exit code ${code}`}.`);
        return out.trim() === '' ? null : out.trim();
      },
    };
  }
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return undefined;
  if (onPath('zenity', env)) {
    return {
      cmd: 'zenity',
      args: ['--file-selection', '--directory', `--title=${PROMPT}`, `--filename=${start}${path.sep}`],
      parse: (code, out, err) => closedOr(code, out, err, () => true),
    };
  }
  if (onPath('kdialog', env)) {
    return {
      cmd: 'kdialog',
      args: ['--getexistingdirectory', start, '--title', PROMPT],
      parse: (code, out, err) => closedOr(code, out, err, () => true),
    };
  }
  return undefined;
}

/** Opens the folder dialog of the system on this machine. Resolves to the folder, or null when the user closed it. */
export async function pickFolder(start: string, signal?: AbortSignal): Promise<string | null> {
  const from = statSync(start, { throwIfNoEntry: false })?.isDirectory() ? start : os.homedir();
  const command = pickerCommand(from);
  if (!command) throw new Error('This system has no folder dialog the tool can open.');
  const r = await exec(command.cmd, command.args, { ...(command.env ? { env: command.env } : {}), ...(signal ? { signal } : {}) });
  return command.parse(r.code, r.stdout, r.stderr);
}
