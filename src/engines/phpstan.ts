import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { home } from '../home.ts';
import { phpFiles } from '../php/files.ts';
import { phpPath, phpVersion, runPhp, usesBundledPhp } from '../php/php.ts';
import { phpTools } from '../php/tools.ts';
import type { Engine, RawFinding } from '../types.ts';

const q = (p: string): string => `'${p.replace(/'/g, "''")}'`;

export function neon(opts: { tools: string; target: string; isFile: boolean; tmpDir: string; vendor?: string; exclude: string[] }): string {
  const lines = [
    'includes:',
    `\t- ${q(`${opts.tools}/vendor/szepeviktor/phpstan-wordpress/extension.neon`)}`,
    'parameters:',
    '\tlevel: 5',
    '\tpaths:',
    `\t\t- ${q(opts.target)}`,
    `\ttmpDir: ${q(opts.tmpDir)}`,
  ];
  if (opts.exclude.length) lines.push('\texcludePaths:', '\t\tanalyse:', ...opts.exclude.map((e) => `\t\t\t- ${q(e)}`));
  if (opts.vendor) lines.push('\tscanDirectories:', `\t\t- ${q(opts.vendor)}`);
  return lines.join('\n') + '\n';
}

interface PhpstanReport {
  files?: Record<string, { messages?: { message: string; line: number | null; identifier?: string; tip?: string }[] }>;
  errors?: string[];
}

export function parsePhpstan(json: string, base: string): RawFinding[] {
  let data: PhpstanReport;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('PHPStan returned output that is not JSON.');
  }
  if (!data || typeof data.files !== 'object' || data.files === null) throw new Error('PHPStan returned output that is not JSON.');
  if (data.errors?.length) throw new Error(`PHPStan stopped: ${data.errors[0]}`);
  const out: RawFinding[] = [];
  for (const [abs, f] of Object.entries(data.files)) {
    const rel = path.relative(base, abs);
    const file = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : abs;
    for (const m of f.messages ?? []) {
      out.push({
        rule: m.identifier ?? 'phpstan',
        severity: 'warning',
        category: 'correctness',
        message: m.message,
        location: { file, ...(typeof m.line === 'number' ? { line: m.line } : {}) },
        ...(m.tip ? { hint: m.tip.replace(/\s*\n\s*/g, ' ') } : {}),
      });
    }
  }
  return out;
}

/** The JSON report: from the first line that starts with a brace. With --debug, PHPStan prints file paths before it. */
export function phpstanJson(stdout: string): string | undefined {
  const start = stdout.search(/^\{/m);
  return start < 0 ? undefined : stdout.slice(start);
}

const isDir = (p: string): boolean => existsSync(p) && statSync(p).isDirectory();

export const phpstan: Engine = {
  id: 'phpstan',
  title: 'PHPStan',
  kinds: ['theme', 'plugin'],
  depth: 'deep',
  async run({ target, signal, note }) {
    await phpVersion(note);
    const tools = await phpTools(note);
    const targetPath = phpPath(target.path);
    const isFile = statSync(targetPath).isFile();
    const base = isFile ? path.dirname(targetPath) : targetPath;
    const exclude = isFile ? [] : [path.join(base, 'vendor'), path.join(base, 'node_modules')].filter(isDir);
    const vendor = !isFile && isDir(path.join(base, 'vendor')) ? path.join(base, 'vendor') : undefined;
    if (!isFile && ['phpstan.neon', 'phpstan.neon.dist', 'phpstan.dist.neon'].some((n) => existsSync(path.join(base, n)))) {
      note('The project has its own PHPStan config. wp-shakedown uses its own settings at level 5.');
    }
    const files = phpFiles(target.path);
    // PHPStan stops with an error when it has no file to read. A block theme can have no PHP at all.
    if (files.length === 0) return [];
    const cfgDir = phpPath(mkdtempSync(path.join(os.tmpdir(), 'wps-phpstan-')));
    const cacheDir = path.join(home(), 'cache', 'phpstan');
    mkdirSync(cacheDir, { recursive: true });
    const analyse = async (broken: string[]): Promise<RawFinding[]> => {
      const cfgFile = path.join(cfgDir, 'phpstan.neon');
      writeFileSync(
        cfgFile,
        neon({ tools, target: targetPath, isFile, tmpDir: phpPath(cacheDir), ...(vendor ? { vendor } : {}), exclude: [...exclude, ...broken] }),
      );
      // Parallel workers cannot connect in the bundled PHP, so PHPStan runs in one process. --debug does that and lists each file before the JSON.
      const r = await runPhp(
        ['-d', 'memory_limit=1G', path.join(tools, 'vendor', 'bin', 'phpstan'), 'analyse', '-c', cfgFile, '--error-format=json', '--no-progress', '--no-interaction', '--memory-limit=1G', ...(usesBundledPhp() ? ['--debug'] : [])],
        { cwd: base, note, ...(signal ? { signal } : {}) },
      );
      const json = phpstanJson(r.stdout);
      if (json === undefined) {
        const line = [r.stderr, r.stdout]
          .flatMap((s) => s.split('\n').map((l) => l.trim()))
          .find((l) => l && !l.startsWith('Warning: Module'));
        throw new Error(`PHPStan stopped: ${line ?? 'no output'}`);
      }
      return parsePhpstan(json, base);
    };
    try {
      const found = await analyse([]);
      // When a file does not parse, PHPStan reports that and nothing else. Run again without those files.
      const broken = [...new Set(found.filter((f) => f.rule === 'phpstan.parse').map((f) => path.join(base, f.location.file!)))];
      if (broken.length === 0) return found;
      note(`Left out ${broken.length} ${broken.length === 1 ? 'file' : 'files'} that PHP cannot parse. php-lint reports them.`);
      if (broken.length >= files.length) return [];
      return (await analyse(broken)).filter((f) => f.rule !== 'phpstan.parse');
    } finally {
      rmSync(cfgDir, { recursive: true, force: true });
    }
  },
};
