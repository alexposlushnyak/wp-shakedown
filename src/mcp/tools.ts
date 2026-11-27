import path from 'node:path';
import { assistantPrompt } from '../assistant/prompt.ts';
import { listRuns, readRun, resolveRun, runText } from '../history.ts';
import { defaultReportDir, readPreviousRun } from '../report/write.ts';
import { toMarkdown } from '../report/markdown.ts';
import { customEngines } from '../engines/custom.ts';
import { listPresets } from '../presets.ts';
import { runSession } from '../session.ts';
import { detectTarget } from '../target.ts';
import { parseLevel } from '../types.ts';
import type { Engine, Finding, Severity } from '../types.ts';

export interface ToolContext {
  engines: Engine[];
  signal: AbortSignal;
  progress: (done: number, total: number, message: string) => void;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

const MAX_TEXT = 60000;
const schema = (properties: Record<string, object>, required: string[]): object => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export interface FindingFilter {
  severity?: Severity;
  engine?: string;
  category?: string;
  file?: string;
  id?: string;
  include_style?: boolean;
}

export function selectFindings(findings: Finding[], f: FindingFilter): Finding[] {
  const file = f.file?.toLowerCase();
  return findings.filter((x) => {
    if (x.suppressed) return false;
    if (x.category === 'standards' && !f.include_style && !f.id) return false;
    if (f.severity && x.severity !== f.severity) return false;
    if (f.engine && x.engine !== f.engine) return false;
    if (f.category && x.category !== f.category) return false;
    if (f.id && x.id !== f.id) return false;
    if (file && !(x.location.file ?? x.location.url ?? '').toLowerCase().includes(file)) return false;
    return true;
  });
}

/** The text of a tool, cut at MAX_TEXT on a line break. */
function clip(text: string, note: string): string {
  if (text.length <= MAX_TEXT) return text;
  const cut = text.lastIndexOf('\n', MAX_TEXT);
  return `${text.slice(0, cut > 0 ? cut : MAX_TEXT)}\n\n${note}`;
}

let running = false;

export const tools: Tool[] = [
  {
    name: 'detect_target',
    title: 'Detect a target',
    description: 'Says what a folder is: a theme, a plugin or a WordPress site, and for a site which themes and plugins it holds.',
    inputSchema: schema({ path: { type: 'string', description: 'Absolute path of the folder.' } }, ['path']),
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const t = detectTarget(args.path as string);
      const units = t.units.map(({ kind, name, path: p }) => ({ kind, name, path: path.relative(t.path, p).split(path.sep).join('/') }));
      return JSON.stringify({ kind: t.kind, name: t.name, path: t.path, units }, null, 2);
    },
  },
  {
    name: 'list_engines',
    title: 'List the engines',
    description: 'Lists the checks wp-shakedown can run, with the ID to pass to run_checks.',
    inputSchema: schema({}, []),
    annotations: { readOnlyHint: true },
    handler: async (_args, ctx) =>
      JSON.stringify([...ctx.engines, ...customEngines()].map(({ id, title, kinds, level }) => ({ id, title, kinds, level })), null, 2),
  },
  {
    name: 'run_checks',
    title: 'Run the checks',
    description:
      'Runs the checks on a theme, a plugin or a WordPress site folder and returns the report as Markdown. Each finding is Critical, Important or Recommended. Fix the Critical ones first. Code style findings are counted per rule and not listed. The run writes report files but never changes the target.',
    get inputSchema() {
      const presets = listPresets().presets;
      return schema(
        {
          path: { type: 'string', description: 'Absolute path of the folder to test.' },
          engines: { type: 'array', items: { type: 'string' }, description: 'Engine IDs to run. Leave out to run all that fit.' },
          preset: {
            type: 'string',
            enum: presets.map((p) => p.id),
            description: 'Run only the engines of one preset, at its level. ' + presets.map((p) => `${p.id}: ${p.summary}`).join(' '),
          },
          profile: { type: 'string', description: 'Old name of preset.' },
          level: { type: 'integer', minimum: 0, maximum: 10, description: 'How thorough the run is, from 0 to 10. A higher level runs more engines. The default is 6. A preset can set its own level.' },
          depth: { type: 'string', enum: ['quick', 'standard', 'deep'], description: 'Old name of level. quick, standard and deep are 3, 6 and 8.' },
          experimental: { type: 'boolean', description: 'Old name. It raises the level to at least 7 and, without a preset, runs the wordpress.org review rules.' },
          type: { type: 'string', enum: ['theme', 'plugin', 'install'], description: 'Use only when detection is wrong.' },
          use_config: { type: 'boolean', description: 'Read wp-shakedown.json from the folder. The default is true.' },
        },
        ['path'],
      );
    },
    annotations: { readOnlyHint: false },
    handler: async (args, ctx) => {
      if (running) throw new Error('A run is in progress. Wait for it to finish.');
      const only = args.engines as string[] | undefined;
      const all = [...ctx.engines, ...customEngines()];
      for (const id of only ?? []) {
        if (!all.some((e) => e.id === id)) throw new Error(`Unknown engine "${id}". Call list_engines for the IDs.`);
      }
      running = true;
      try {
        let total = 0;
        let done = 0;
        const type = args.type as 'theme' | 'plugin' | 'install' | undefined;
        const level = args.level !== undefined ? (args.level as number) : args.depth !== undefined ? parseLevel(args.depth as string) : undefined;
        const preset = (args.preset ?? args.profile) as string | undefined;
        const s = await runSession({
          input: args.path as string,
          ...(type ? { type } : {}),
          ...(only?.length ? { only } : {}),
          ...(preset ? { preset } : {}),
          ...(level !== undefined ? { level } : {}),
          ...(args.experimental ? { experimental: true } : {}),
          ...(args.use_config === false ? { config: false } : {}),
          engines: ctx.engines,
          signal: ctx.signal,
          onEvent: (e) => {
            if (e.type === 'run:start') total = e.jobs.length;
            else if (e.type === 'engine:end') {
              done++;
              ctx.progress(done, total, `${e.run.engine}: ${e.run.status}`);
            }
          },
        });
        const text = toMarkdown(s.result, s.diff);
        if (text.length > MAX_TEXT) {
          const cut = text.lastIndexOf('\n', MAX_TEXT);
          return `${text.slice(0, cut > 0 ? cut : MAX_TEXT)}\n\nThe report is cut here. The full report is at ${s.files[0]}. Call list_findings to page through the findings.`;
        }
        return `${text}\n\nReport file: ${s.files[0]}`;
      } finally {
        running = false;
      }
    },
  },
  {
    name: 'list_findings',
    title: 'List findings of the last run',
    description:
      'Returns findings from the last run on a folder, filtered and paged, as JSON. Use it after run_checks when the report was cut or when you want one severity, engine or file.',
    inputSchema: schema(
      {
        path: { type: 'string', description: 'Absolute path of the folder that was tested.' },
        severity: { type: 'string', enum: ['error', 'warning', 'info'], description: 'error is Critical, warning is Important, info is Recommended.' },
        engine: { type: 'string' },
        category: { type: 'string' },
        file: { type: 'string', description: 'Part of a file path.' },
        id: { type: 'string', description: 'One finding ID.' },
        include_style: { type: 'boolean', description: 'Also list code style findings. They are left out by default.' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        offset: { type: 'integer', minimum: 0 },
      },
      ['path'],
    ),
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const target = detectTarget(args.path as string);
      const prev = readPreviousRun(defaultReportDir(target));
      if (!prev) throw new Error('No report for this folder yet. Call run_checks first.');
      const selected = selectFindings(prev.findings, args as FindingFilter);
      const limit = (args.limit as number | undefined) ?? 50;
      const offset = (args.offset as number | undefined) ?? 0;
      const page = selected.slice(offset, offset + limit);
      return JSON.stringify(
        {
          total: selected.length,
          offset,
          findings: page.map((x) => ({
            id: x.id,
            severity: x.severity,
            category: x.category,
            engine: x.engine,
            rule: x.rule,
            message: x.message,
            file: x.location.file ?? x.location.url,
            line: x.location.line,
            hint: x.hint,
            docs: x.docs,
            unit: x.unit,
          })),
        },
        null,
        2,
      );
    },
  },
  {
    name: 'list_presets',
    title: 'List the presets',
    description: 'Lists the presets: each one is a set of engines for one purpose, with its level. Pass an ID to run_checks as preset.',
    inputSchema: schema({}, []),
    annotations: { readOnlyHint: true },
    handler: async () =>
      JSON.stringify(
        listPresets().presets.map(({ id, title, summary, kinds, level, engines, failOn, directory, assistant, builtIn }) => ({
          id,
          title,
          summary,
          kinds,
          level,
          engines,
          failOn,
          directory,
          assistant,
          builtIn,
        })),
        null,
        2,
      ),
  },
  {
    name: 'list_runs',
    title: 'List the past runs',
    description: 'Lists the past runs on a folder, newest first, with their counts. Pass a number or a run ID to get_run.',
    inputSchema: schema({ path: { type: 'string', description: 'Absolute path of the folder that was tested.' } }, ['path']),
    annotations: { readOnlyHint: true },
    handler: async (args) =>
      JSON.stringify(
        listRuns(defaultReportDir(detectTarget(args.path as string))).map((e, i) => ({ number: i + 1, ...e })),
        null,
        2,
      ),
  },
  {
    name: 'get_run',
    title: 'Get a past run',
    description:
      'Returns one past run as a short Markdown report, compared with the run before it. Set full for the whole report. Set against to compare with another run.',
    inputSchema: schema(
      {
        path: { type: 'string', description: 'Absolute path of the folder that was tested.' },
        run: { type: 'string', description: 'A number from list_runs (1 is the newest) or a run ID.' },
        against: { type: 'string', description: 'The run to compare with, as a number or a run ID. The default is the run before.' },
        full: { type: 'boolean', description: 'Return the full report and not the short one.' },
      },
      ['path', 'run'],
    ),
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const dir = defaultReportDir(detectTarget(args.path as string));
      const text = runText(dir, String(args.run), {
        ...(args.against !== undefined ? { against: String(args.against) } : {}),
        ...(args.full ? { full: true } : {}),
        hint: 'list_runs',
      });
      return clip(text, `The report is cut here. Call list_findings to page through the findings of the last run.`);
    },
  },
  {
    name: 'get_assistant_checks',
    title: 'Get the checks for an assistant',
    description:
      'Returns the checks the last run leaves to an assistant, each with a full prompt. Work through them yourself: read the files each one names, then answer each check.',
    inputSchema: schema(
      {
        path: { type: 'string', description: 'Absolute path of the folder that was tested.' },
        run: { type: 'string', description: 'A number from list_runs or a run ID. The default is the newest run.' },
      },
      ['path'],
    ),
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const dir = defaultReportDir(detectTarget(args.path as string));
      const entries = listRuns(dir);
      const ref = args.run !== undefined ? String(args.run) : '1';
      const entry = resolveRun(entries, ref);
      const result = entry ? readRun(dir, entry.run) : undefined;
      if (!result) {
        if (args.run !== undefined) throw new Error(`No run "${ref}". list_runs lists them.`);
        throw new Error('No report for this folder yet. Call run_checks first.');
      }
      if (!result.assistant?.length) return 'The last run lists no checks for an assistant. Run run_checks at level 7 or higher on a theme or plugin.';
      const parts = result.assistant.map((a) => `## ${a.id}: ${a.title}\n\n${assistantPrompt(a, result.target)}`);
      return clip(`# Checks for an assistant: ${result.target.name}\n\n${parts.join('\n\n')}\n`, 'The list is cut here.');
    },
  },
];
