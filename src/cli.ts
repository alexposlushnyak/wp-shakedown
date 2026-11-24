#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadBaseline } from './baseline.ts';
import { diffRuns } from './diff.ts';
import { engines } from './engines/index.ts';
import { progressLine } from './progress.ts';
import { noEngineLine, summaryLine } from './report/markdown.ts';
import { assertReportDir, defaultReportDir, readPreviousRun, writeReports } from './report/write.ts';
import { exitCode, run } from './runner.ts';
import { detectTarget } from './target.ts';
import { VERSION } from './version.ts';
import type { Severity } from './types.ts';

const HELP = `wp-shakedown ${VERSION}

Usage:
  wp-shakedown run <path> [options]

Options:
  --type <kind>       Treat the path as a theme, plugin or install
  --engine <id>       Run only this engine. Repeat for more than one
  --out <dir>         Write the report here
  --baseline <file>   Use this baseline file
  --fail-on <level>   Exit 1 at this severity: error, warning, info or never
  -h, --help          Show this help
  -v, --version       Show the version

Exit codes: 0 clean, 1 findings at or above --fail-on, 2 the run itself failed.
`;

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

    const target = detectTarget(input, type ? { type } : {});
    let baselineFile = values.baseline;
    if (!baselineFile && target.kind !== 'url') {
      const candidate = path.join(target.path, 'wp-shakedown-baseline.json');
      if (existsSync(candidate)) baselineFile = candidate;
    }
    const baseline = baselineFile ? loadBaseline(baselineFile) : undefined;
    const dir = values.out ?? defaultReportDir(target);
    assertReportDir(target, dir);
    const previous = readPreviousRun(dir);
    const result = await run(target, {
      engines,
      ...(values.engine ? { only: values.engine } : {}),
      ...(baseline ? { baseline } : {}),
      onEvent: (e) => {
        const line = progressLine(e);
        if (line) console.error(line);
      },
    });
    const diff = previous ? diffRuns(previous, result) : undefined;
    const files = writeReports(result, dir, diff);

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
