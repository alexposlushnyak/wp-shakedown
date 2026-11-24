#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { engines } from './engines/index.ts';
import { profiles } from './profiles.ts';
import { hubExitCode, hubLines, projectTable, runMany } from './hub.ts';
import type { HubRow } from './hub.ts';
import { addProject, listProjects, removeProject } from './projects.ts';
import { progressLine } from './progress.ts';
import { noEngineLine, summaryLine } from './report/markdown.ts';
import { exitCode } from './runner.ts';
import { runSession } from './session.ts';
import { startMcp } from './mcp/server.ts';
import { startUi } from './ui/server.ts';
import { VERSION } from './version.ts';
import type { Severity } from './types.ts';

const profileList = `${profiles.slice(0, -1).map((p) => p.id).join(', ')} or ${profiles[profiles.length - 1]!.id}`;

const HELP = `wp-shakedown ${VERSION}

Usage:
  wp-shakedown run <path>... [options]
  wp-shakedown run --all [options]
  wp-shakedown add <path>...
  wp-shakedown remove <project>...
  wp-shakedown list
  wp-shakedown ui [path] [options]
  wp-shakedown mcp

Options:
  --type <kind>       Treat the path as a theme, plugin or install
  --engine <id>       Run only this engine. Repeat for more than one
  --profile <id>      Run the engines for one gate: ${profileList}
  --depth <level>     How thorough the run is: quick, standard or deep. The default is standard
  --out <dir>         Write the report here
  --baseline <file>   Use this baseline file
  --fail-on <level>   Exit 1 at this severity: error, warning, info or never
  --all               Run every project on the list
  --jobs <n>          How many projects run at once. The default is 3
  --port <n>          Port for the ui command. The default is a free port
  --no-open           Do not open the browser
  -h, --help          Show this help
  -v, --version       Show the version

Exit codes: 0 clean, 1 findings at or above --fail-on, 2 the run itself failed.
`;

function add(paths: string[]): number {
  if (paths.length === 0) {
    console.error('wp-shakedown: Give a folder to add, for example: wp-shakedown add ./my-theme');
    return 2;
  }
  const labels = { theme: 'theme', plugin: 'plugin', install: 'WordPress folder', url: 'site URL' };
  let code = 0;
  for (const p of paths) {
    try {
      const { project, added } = addProject(p);
      console.log(added ? `Added the ${labels[project.kind!]} "${project.name}".` : `"${project.name}" is already on the list.`);
    } catch (err) {
      console.error(`wp-shakedown: ${err instanceof Error ? err.message : String(err)}`);
      code = 2;
    }
  }
  return code;
}

function remove(keys: string[]): number {
  if (keys.length === 0) {
    console.error('wp-shakedown: Name a project to remove. wp-shakedown list shows them.');
    return 2;
  }
  let code = 0;
  for (const k of keys) {
    if (removeProject(k)) console.log(`Removed "${k}". Its reports stay.`);
    else {
      console.error(`wp-shakedown: No project fits "${k}".`);
      code = 2;
    }
  }
  return code;
}

function list(): number {
  const projects = listProjects();
  console.log(projects.length === 0 ? 'No projects yet. Add one with: wp-shakedown add <path>' : projectTable(projects));
  return 0;
}

interface RunFlags {
  type?: 'theme' | 'plugin' | 'install';
  only?: string[];
  profile?: string;
  depth?: 'quick' | 'standard' | 'deep';
  failOn: Severity | 'never';
}

async function runHub(inputs: string[], jobs: number, f: RunFlags): Promise<number> {
  const ac = new AbortController();
  const onSigint = (): void => ac.abort();
  process.once('SIGINT', onSigint);
  const live = process.stderr.isTTY;
  let drawn = 0;
  let timer: NodeJS.Timeout | undefined;
  const draw = (rows: HubRow[]): void => {
    timer = undefined;
    const lines = hubLines(rows, process.stderr.columns || 80);
    process.stderr.write((drawn ? `\x1b[${drawn}A` : '') + lines.map((l) => `\x1b[2K${l}\n`).join(''));
    drawn = lines.length;
  };
  let latest: HubRow[] = [];
  const rows = await runMany(inputs, {
    jobs,
    session: {
      engines,
      signal: ac.signal,
      ...(f.type ? { type: f.type } : {}),
      ...(f.only ? { only: f.only } : {}),
      ...(f.profile ? { profile: f.profile } : {}),
      ...(f.depth ? { depth: f.depth } : {}),
    },
    onChange: (all, row, event) => {
      latest = all;
      if (live) timer ??= setTimeout(() => draw(latest), 100);
      else if (event) {
        const line = progressLine(event);
        if (line) console.error(`[${row.name}] ${line}`);
      } else if (row.state === 'failed') console.error(`[${row.name}] failed: ${row.error}`);
    },
  });
  process.off('SIGINT', onSigint);
  if (live) {
    if (timer) clearTimeout(timer);
    draw(rows);
  }
  for (const r of rows) {
    console.log(r.state === 'done' ? `${r.name}: ${summaryLine(r.result!)} Report: ${r.reportFile}` : `${r.name}: failed: ${r.error}`);
  }
  return hubExitCode(rows, f.failOn);
}

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
  if (input !== undefined) {
    try {
      addProject(startDir);
    } catch {
      // A folder that is not a theme, a plugin or a WordPress folder is only the place to start browsing.
    }
  }
  const server = await startUi({ engines, startDir, ...(port !== undefined ? { port } : {}) });
  // Listen for the signal before printing the address. Whoever reads that line may send the signal at once.
  const stopped = new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  console.log(`wp-shakedown is running at ${server.url}`);
  console.log('Press Ctrl+C to stop.');
  if (!noOpen) openBrowser(server.url);
  await stopped;
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
        profile: { type: 'string' },
        depth: { type: 'string' },
        out: { type: 'string' },
        baseline: { type: 'string' },
        'fail-on': { type: 'string' },
        all: { type: 'boolean' },
        jobs: { type: 'string' },
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
    if (command === 'add') return add(positionals.slice(1));
    if (command === 'remove') return remove(positionals.slice(1));
    if (command === 'list') return list();
    if (command === 'mcp') {
      await startMcp({ engines, input: process.stdin, output: process.stdout }).closed;
      return 0;
    }
    if (command === 'ui') return await ui(input, values.port, values['no-open'] ?? false);
    if (command !== 'run') throw new Error(`Unknown command "${command}". Run wp-shakedown --help.`);
    const paths = positionals.slice(1);
    const all = values.all ?? false;
    if (all && paths.length > 0) throw new Error('Use --all or paths, not both.');
    if (!all && paths.length === 0) throw new Error('Give a folder to test, for example: wp-shakedown run ./my-theme');
    let jobs = 3;
    if (values.jobs !== undefined) {
      jobs = Number(values.jobs);
      if (!/^\d+$/.test(values.jobs) || jobs < 1 || jobs > 8) throw new Error('--jobs must be a number from 1 to 8.');
    }
    const many = all || paths.length > 1;
    if (many && values.out) throw new Error('--out works with one path.');
    if (many && values.baseline) throw new Error('--baseline works with one path.');
    const type = values.type;
    if (type !== undefined && type !== 'theme' && type !== 'plugin' && type !== 'install') {
      throw new Error('--type must be theme, plugin or install.');
    }
    const depth = values.depth;
    if (depth !== undefined && depth !== 'quick' && depth !== 'standard' && depth !== 'deep') {
      throw new Error('--depth must be quick, standard or deep.');
    }
    const failOn = values['fail-on'] ?? 'error';
    if (failOn !== 'error' && failOn !== 'warning' && failOn !== 'info' && failOn !== 'never') {
      throw new Error('--fail-on must be error, warning, info or never.');
    }

    if (many) {
      // The same folder twice would write one report folder from two runs.
      const targets = all ? listProjects().filter((p) => p.kind).map((p) => p.path) : [...new Set(paths.map((p) => path.resolve(p)))];
      if (targets.length === 0) throw new Error('No projects yet. Add one with: wp-shakedown add <path>');
      return await runHub(targets, jobs, {
        ...(type ? { type } : {}),
        ...(values.engine ? { only: values.engine } : {}),
        ...(values.profile ? { profile: values.profile } : {}),
        ...(depth ? { depth } : {}),
        failOn: failOn as Severity | 'never',
      });
    }

    const { result, diff, files } = await runSession({
      input: input!,
      ...(type ? { type } : {}),
      ...(values.engine ? { only: values.engine } : {}),
      ...(values.profile ? { profile: values.profile } : {}),
      ...(depth ? { depth } : {}),
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
