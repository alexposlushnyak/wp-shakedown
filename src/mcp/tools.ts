import path from 'node:path';
import { defaultReportDir, readPreviousRun } from '../report/write.ts';
import { toMarkdown } from '../report/markdown.ts';
import { customEngines } from '../engines/custom.ts';
import { profiles } from '../profiles.ts';
import { runSession } from '../session.ts';
import { detectTarget } from '../target.ts';
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
      JSON.stringify([...ctx.engines, ...customEngines()].map(({ id, title, kinds, depth, experimental }) => ({ id, title, kinds, depth: depth ?? 'standard', ...(experimental ? { experimental: true } : {}) })), null, 2),
  },
  {
    name: 'run_checks',
    title: 'Run the checks',
    description:
      'Runs the checks on a theme, a plugin or a WordPress site folder and returns the report as Markdown. Errors come first in importance. Code style findings are counted per rule and not listed. The run writes report files but never changes the target.',
    inputSchema: schema(
      {
        path: { type: 'string', description: 'Absolute path of the folder to test.' },
        engines: { type: 'array', items: { type: 'string' }, description: 'Engine IDs to run. Leave out to run all that fit.' },
        profile: {
          type: 'string',
          enum: profiles.map((p) => p.id),
          description: 'Run only the engines for one gate. ' + profiles.map((p) => `${p.id}: ${p.summary}`).join(' '),
        },
        depth: { type: 'string', enum: ['quick', 'standard', 'deep'], description: 'How thorough the run is. quick runs the fast checks, standard is the default, deep adds static analysis.' },
        experimental: { type: 'boolean', description: 'Also run the experimental engines, such as theme-review.' },
        type: { type: 'string', enum: ['theme', 'plugin', 'install'], description: 'Use only when detection is wrong.' },
      },
      ['path'],
    ),
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
        const depth = args.depth as 'quick' | 'standard' | 'deep' | undefined;
        const s = await runSession({
          input: args.path as string,
          ...(type ? { type } : {}),
          ...(only?.length ? { only } : {}),
          ...(args.profile ? { profile: args.profile as string } : {}),
          ...(depth ? { depth } : {}),
          ...(args.experimental ? { experimental: true } : {}),
          engines: ctx.engines,
          signal: ctx.signal,
          onEvent: (e) => {
            if (e.type === 'run:start') total = e.jobs.length;
            else if (e.type === 'engine:end') {
              done++;
              ctx.progress(done, total, `${e.run.engine}${e.run.unit ? ' ' + e.run.unit : ''}: ${e.run.status}`);
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
        severity: { type: 'string', enum: ['error', 'warning', 'info'] },
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
];
