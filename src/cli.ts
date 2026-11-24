#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { engines } from './engines/index.ts';
import { progressLine } from './progress.ts';
import { noEngineLine, summaryLine } from './report/markdown.ts';
import { exitCode } from './runner.ts';
import { runSession } from './session.ts';
import { startUi } from './ui/server.ts';
import { VERSION } from './version.ts';
import type { Severity } from './types.ts';

const HELP = `wp-shakedown ${VERSION}

Usage:
  wp-shakedown run <path> [options]
  wp-shakedown ui [path] [options]

Options:
  --type <kind>       Treat the path as a theme, plugin or install
  --engine <id>       Run only this engine. Repeat for more than one
  --out <dir>         Write the report here
  --baseline <file>   Use this baseline file
  --fail-on <level>   Exit 1 at this severity: error, warning, info or never
  --port <n>          Port for the ui command. The default is a free port
  --no-open           Do not open the browser
  -h, --help          Show this help
  -v, --version       Show the version

Exit codes: 0 clean, 1 findings at or above --fail-on, 2 the run itself failed.
`;

function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is printed, so a missing opener costs nothing.
  }
}

async function ui(input: string | undefined, portText: string | undefined, noOpen: boolean): Promise<number> {
  let port: number | undefined;
  if (portText !== undefined) {
    port = Number(portText);
    if (!/^\d+$/.test(portText) || port > 65535) throw new Error('--port must be a number from 0 to 65535.');
  }
  const startDir = path.resolve(input ?? process.cwd());
  if (!statSync(startDir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`"${input}" is not a folder.`);
  const server = await startUi({ engines, startDir, ...(port !== undefined ? { port } : {}) });
  console.log(`wp-shakedown is running at ${server.url}`);
  console.log('Press Ctrl+C to stop.');
  if (!noOpen) openBrowser(server.url);
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await server.close();
  return 0;
}

async function main(argv: string[]): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        type: { type: 'string' },
        engine: { type: 'string', multiple: true },
        out: { type: 'string' },
        baseline: { type: 'string' },
        'fail-on': { type: 'string' },
        port: { type: 'string' },
        'no-open': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
    if (values.version) {
      console.log(VERSION);
      return 0;
    }
    if (values.help || positionals.length === 0) {
      process.stdout.write(HELP);
      return 0;
    }
    const [command, input] = positionals;
    if (command === 'ui') return await ui(input, values.port, values['no-open'] ?? false);
    if (command !== 'run') throw new Error(`Unknown command "${command}". Run wp-shakedown --help.`);
    if (!input) throw new Error('Give a folder to test, for example: wp-shakedown run ./my-theme');
    const type = values.type;
    if (type !== undefined && type !== 'theme' && type !== 'plugin' && type !== 'install') {
      throw new Error('--type must be theme, plugin or install.');
    }
    const failOn = values['fail-on'] ?? 'error';
    if (failOn !== 'error' && failOn !== 'warning' && failOn !== 'info' && failOn !== 'never') {
      throw new Error('--fail-on must be error, warning, info or never.');
    }

    const { result, diff, files } = await runSession({
      input,
      ...(type ? { type } : {}),
      ...(values.engine ? { only: values.engine } : {}),
      ...(values.out ? { out: values.out } : {}),
      ...(values.baseline ? { baselineFile: values.baseline } : {}),
      engines,
      onEvent: (e) => {
        const line = progressLine(e);
        if (line) console.error(line);
      },
    });

    console.log(summaryLine(result));
    if (result.engines.length === 0) console.log(noEngineLine(result));
    if (diff) console.log(`${diff.fixed.length} fixed, ${diff.added.length} new, ${diff.open.length} still open.`);
    console.log(`Report: ${files[0]}`);
    return exitCode(result, failOn as Severity | 'never');
  } catch (err) {
    console.error(`wp-shakedown: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
