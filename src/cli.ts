#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runAssist, counts } from './assistant/assist.ts';
import { removeAnthropicKey, saveAnthropicKey } from './assistant/keys.ts';
import { engines } from './engines/index.ts';
import { listRuns, runText } from './history.ts';
import { listPresets, presetTable } from './presets.ts';
import { hubExitCode, hubLines, projectTable, runMany } from './hub.ts';
import type { HubRow } from './hub.ts';
import { addProject, findProject, listProjects, removeProject } from './projects.ts';
import { progressLine } from './progress.ts';
import { noEngineLine, plural, runLabel, summaryLine } from './report/markdown.ts';
import { defaultReportDir } from './report/write.ts';
import { detectTarget } from './target.ts';
import { exitCode } from './runner.ts';
import { runSession } from './session.ts';
import { startMcp } from './mcp/server.ts';
import { startUi } from './ui/server.ts';
import { textTable } from './table.ts';
import { importZip } from './uploads.ts';
import { VERSION } from './version.ts';
import { parseFailOn, parseLevel } from './types.ts';
import type { Severity } from './types.ts';

const help = (): string => {
  const ids = listPresets().presets.map((p) => p.id);
  const presetList = `${ids.slice(0, -1).join(', ')} or ${ids[ids.length - 1]}`;
  return `wp-shakedown ${VERSION}

Usage:
  wp-shakedown run <path>... [options]   A path can be a folder or a ZIP file
  wp-shakedown run --all [options]
  wp-shakedown add <path>...
  wp-shakedown remove <project>...
  wp-shakedown list
  wp-shakedown presets
  wp-shakedown history <project> [run] [--against <run>] [--full]
  wp-shakedown assist <project> [--check <id>]... [--out <dir>]
  wp-shakedown key set anthropic | remove anthropic
  wp-shakedown ui [path] [options]
  wp-shakedown mcp

Options:
  --type <kind>       Treat the path as a theme, plugin or install
  --engine <id>       Run only this engine. Repeat for more than one
  --check <id>        With assist: answer only this check. Repeat for more than one
  --preset <id>       Run the engines of one preset: ${presetList}
  --level <n>         How thorough the run is, from 0 to 10. The default is 6. quick, standard and deep work as 3, 6 and 8
                      --experimental is an old name: level 7 or more, with the wordpress.org rules
  --no-config         Ignore wp-shakedown.json in the target
  --out <dir>         Write the report here
  --baseline <file>   Use this baseline file
  --fail-on <name>    Exit 1 at this severity or above: critical, important, recommended or never. A preset can set it
  --against <run>     With history: compare the run with this one instead of the run before it
  --full              With history: print the full report instead of the short one
  --all               Run every project on the list
  --jobs <n>          How many projects run at once. The default is 3
  --port <n>          Port for the ui command. The default is a free port
  --no-open           Do not open the browser
  -h, --help          Show this help
  -v, --version       Show the version

Exit codes: 0 clean, 1 findings at or above --fail-on, 2 the run itself failed.
`;
};

/** A ZIP file becomes the folder it unpacks to under ~/.wp-shakedown/uploads. Anything else stays as given. */
function folderOf(p: string): string {
  return /\.zip$/i.test(p) && statSync(p, { throwIfNoEntry: false })?.isFile() ? importZip(readFileSync(p), path.basename(p)) : p;
}

function add(paths: string[]): number {
  if (paths.length === 0) {
    console.error('wp-shakedown: Give a folder to add, for example: wp-shakedown add ./my-theme');
    return 2;
  }
  const labels = { theme: 'theme', plugin: 'plugin', install: 'WordPress folder', url: 'site URL' };
  let code = 0;
  for (const p of paths) {
    try {
      const { project, added } = addProject(folderOf(p));
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

function presets(): number {
  const { presets: all, problems } = listPresets();
  console.log(presetTable(all));
  if (problems.length > 0) {
    console.log('');
    for (const p of problems) console.log(`${p.file} is not a valid preset: ${p.error}.`);
  }
  return 0;
}

/** Lists the runs kept for a project, or prints one of them. A run is a number from the list or a run id. */
function history(args: string[], flags: { out?: string; against?: string; full?: boolean }): number {
  let [project, ref] = args;
  // With --out the project can be left out, so one argument that looks like a run is the run.
  if (flags.out && args.length === 1 && /^(\d{1,4}|\d{4}-\d{2}-\d{2}T.*)$/.test(project!)) [project, ref] = [undefined, project];
  let dir: string;
  let name: string;
  if (flags.out) {
    dir = flags.out;
    name = project ?? path.basename(path.resolve(flags.out));
  } else {
    if (!project) throw new Error('Name a project, for example: wp-shakedown history my-theme');
    const target = detectTarget(findProject(project)?.path ?? project);
    dir = defaultReportDir(target);
    name = target.name;
  }
  const entries = listRuns(dir);
  if (ref === undefined) {
    if (entries.length === 0) {
      console.log(`No runs yet for "${name}". Run wp-shakedown run <path> first.`);
      return 0;
    }
    const rows = entries.map((e, i) => [
      String(i + 1),
      runLabel(e.finishedAt),
      String(e.summary.error),
      String(e.summary.warning),
      String(e.summary.info),
      e.level !== undefined ? String(e.level) : '-',
      e.preset ?? '-',
      e.failed > 0 ? `failed engines: ${e.failed}` : '',
    ]);
    console.log(textTable([['#', 'Run', 'Critical', 'Important', 'Recommended', 'Level', 'Preset', ''], ...rows]).join('\n'));
    return 0;
  }
  try {
    process.stdout.write(runText(dir, ref, { ...(flags.against !== undefined ? { against: flags.against } : {}), ...(flags.full ? { full: true } : {}), hint: `wp-shakedown history ${project ?? `--out ${dir}`}` }));
  } catch (err) {
    console.error(`wp-shakedown: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  return 0;
}

/** Answers the assistant checks of the newest run of a project. */
async function assist(project: string | undefined, flags: { out?: string; check?: string[] }): Promise<number> {
  if (!project) throw new Error('Name a project, for example: wp-shakedown assist my-theme');
  const target = detectTarget(findProject(project)?.path ?? project);
  const dir = flags.out ?? defaultReportDir(target);
  const { report, files } = await runAssist({
    dir,
    target,
    ...(flags.check ? { checks: flags.check } : {}),
    onAnswer: (a) => console.error(`${a.verdict} ${a.check}: ${plural(a.findings.length, 'finding', 'findings')}${a.error ? `: ${a.error}` : ''}`),
  });
  const c = counts(report.answers);
  console.log(`${c.pass} pass, ${c.fail} fail, ${c.unsure} unsure.`);
  console.log(`Answers: ${files[0]}`);
  return 0;
}

/** Reads the key from stdin. On a terminal it prints a prompt and does not echo what is typed. */
function readSecret(): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      let text = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => (text += c));
      stdin.on('end', () => resolve(text.trim()));
      stdin.on('error', reject);
      return;
    }
    process.stderr.write('Paste the key and press Enter:');
    let text = '';
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const done = (fn: () => void): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stderr.write('\n');
      fn();
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\x04') return done(() => resolve(text.trim()));
        if (ch === '\x03') return done(() => reject(new Error('Cancelled.')));
        if (ch === '\x7f' || ch === '\b') text = text.slice(0, -1);
        else text += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function key(action: string | undefined, provider: string | undefined): Promise<number> {
  if ((action !== 'set' && action !== 'remove') || !provider) throw new Error('Use wp-shakedown key set anthropic or wp-shakedown key remove anthropic.');
  if (provider !== 'anthropic') {
    console.error('wp-shakedown: Only anthropic keys are stored. Claude Code and Codex use their own sign-in.');
    return 2;
  }
  if (action === 'remove') {
    console.log(removeAnthropicKey() ? 'Removed the key.' : 'No key saved.');
    return 0;
  }
  const value = await readSecret();
  if (!value) throw new Error('No key given.');
  console.log(`Saved the key to ${saveAnthropicKey(value)}.`);
  return 0;
}

interface RunFlags {
  type?: 'theme' | 'plugin' | 'install';
  only?: string[];
  preset?: string;
  level?: number;
  experimental?: boolean;
  failOn?: Severity | 'never';
  noConfig?: boolean;
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
      ...(f.preset ? { preset: f.preset } : {}),
      ...(f.experimental ? { experimental: true } : {}),
      ...(f.level !== undefined ? { level: f.level } : {}),
      ...(f.noConfig ? { config: false } : {}),
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
        check: { type: 'string', multiple: true },
        preset: { type: 'string' },
        profile: { type: 'string' },
        level: { type: 'string' },
        depth: { type: 'string' },
        experimental: { type: 'boolean' },
        out: { type: 'string' },
        against: { type: 'string' },
        full: { type: 'boolean' },
        baseline: { type: 'string' },
        'fail-on': { type: 'string' },
        all: { type: 'boolean' },
        jobs: { type: 'string' },
        port: { type: 'string' },
        'no-open': { type: 'boolean' },
        'no-config': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
    if (values.version) {
      console.log(VERSION);
      return 0;
    }
    if (values.help || positionals.length === 0) {
      process.stdout.write(help());
      return 0;
    }
    const [command, input] = positionals;
    if (command === 'add') return add(positionals.slice(1));
    if (command === 'remove') return remove(positionals.slice(1));
    if (command === 'list') return list();
    if (command === 'presets') return presets();
    if (command === 'history') {
      return history(positionals.slice(1), {
        ...(values.out ? { out: values.out } : {}),
        ...(values.against ? { against: values.against } : {}),
        ...(values.full ? { full: true } : {}),
      });
    }
    if (command === 'assist') return await assist(input, { ...(values.out ? { out: values.out } : {}), ...(values.check ? { check: values.check } : {}) });
    if (command === 'key') return await key(positionals[1], positionals[2]);
    if (command === 'mcp') {
      await startMcp({ engines, input: process.stdin, output: process.stdout }).closed;
      return 0;
    }
    if (command === 'ui') return await ui(input, values.port, values['no-open'] ?? false);
    if (command !== 'run') throw new Error(`Unknown command "${command}". Run wp-shakedown --help.`);
    const paths = positionals.slice(1).map(folderOf);
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
    const levelText = values.level ?? values.depth;
    const level = levelText !== undefined ? parseLevel(levelText) : undefined;
    const preset = values.preset ?? values.profile;
    // A preset or the settings of the project set the exit threshold unless --fail-on is given.
    const failOn = values['fail-on'] !== undefined ? parseFailOn(values['fail-on']) : undefined;

    if (many) {
      // The same folder twice would write one report folder from two runs.
      const targets = all ? listProjects().filter((p) => p.kind).map((p) => p.path) : [...new Set(paths.map((p) => path.resolve(p)))];
      if (targets.length === 0) throw new Error('No projects yet. Add one with: wp-shakedown add <path>');
      return await runHub(targets, jobs, {
        ...(type ? { type } : {}),
        ...(values.engine ? { only: values.engine } : {}),
        ...(preset ? { preset } : {}),
        ...(level !== undefined ? { level } : {}),
        ...(values.experimental ? { experimental: true } : {}),
        ...(failOn ? { failOn } : {}),
        ...(values['no-config'] ? { noConfig: true } : {}),
      });
    }

    const session = await runSession({
      input: paths[0]!,
      ...(type ? { type } : {}),
      ...(values.engine ? { only: values.engine } : {}),
      ...(preset ? { preset } : {}),
      ...(level !== undefined ? { level } : {}),
      ...(values.experimental ? { experimental: true } : {}),
      ...(values.out ? { out: values.out } : {}),
      ...(values.baseline ? { baselineFile: values.baseline } : {}),
      ...(values['no-config'] ? { config: false } : {}),
      engines,
      onEvent: (e) => {
        const line = progressLine(e);
        if (line) console.error(line);
      },
    });

    const { result, diff, files } = session;
    if (session.configFile) console.error(`Settings from ${session.configFile}.`);
    console.log(summaryLine(result));
    if (result.engines.length === 0) console.log(noEngineLine(result));
    if (diff) console.log(`${diff.fixed.length} fixed, ${diff.added.length} new, ${diff.open.length} still open.`);
    console.log(`Report: ${files[0]}`);
    return exitCode(result, failOn ?? session.failOn ?? 'error');
  } catch (err) {
    console.error(`wp-shakedown: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
