export const SEVERITIES = ['error', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export type Category =
  | 'security'
  | 'compatibility'
  | 'standards'
  | 'correctness'
  | 'performance'
  | 'accessibility'
  | 'i18n'
  | 'health'
  | 'other';

/** What human-facing text calls each severity. JSON and SARIF keep the internal names. */
export const SEVERITY_NAMES = { error: 'Critical', warning: 'Important', info: 'Recommended' } as const;

/** The highest level. A run at a level runs every engine whose own level is that or lower. */
export const MAX_LEVEL = 10;
/** Names that stand for a level. */
export const LEVEL_NAMES = { quick: 3, standard: 6, deep: 8 } as const;
/** The level of a run that sets none. */
export const DEFAULT_LEVEL = LEVEL_NAMES.standard;
/** The old depth names. Only reports written before levels still carry them. */
export type Depth = keyof typeof LEVEL_NAMES;

/** An integer from 0 to 10 or a level name becomes the level. Throws on anything else. */
export function parseLevel(v: string | number): number {
  const n = typeof v === 'number' ? v : /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  if (Number.isInteger(n) && n >= 0 && n <= MAX_LEVEL) return n;
  if (typeof v === 'string' && Object.hasOwn(LEVEL_NAMES, v)) return LEVEL_NAMES[v as Depth];
  throw new Error('Level must be a number from 0 to 10, or quick, standard or deep.');
}

export type TargetKind = 'theme' | 'plugin' | 'install' | 'url';

export interface Target {
  kind: TargetKind;
  /** Absolute path of the folder. A one-file plugin has the path of its PHP file. A 'url' target has the URL. */
  path: string;
  /** Name from the theme or plugin header, the folder name otherwise. */
  name: string;
  /** Themes and plugins found inside an install. Empty for every other kind. */
  units: Target[];
}

export interface Location {
  /** POSIX path relative to the root target. */
  file?: string;
  line?: number;
  column?: number;
  url?: string;
  selector?: string;
}

/** What an engine returns. `location.file` is relative to the target the engine was given. */
export interface RawFinding {
  rule: string;
  severity: Severity;
  category: Category;
  message: string;
  location: Location;
  hint?: string;
  docs?: string;
}

export interface Finding extends RawFinding {
  /** Stable between runs. The line is not part of it, so edits above a finding keep its ID. */
  id: string;
  engine: string;
  /** Set when the finding belongs to a theme or plugin inside an install, as `theme:<folder>` or `plugin:<folder>`. */
  unit?: string;
  /** Command that runs the engine that produced this finding again. */
  rerun: string;
  suppressed?: { reason: string };
}

export interface EngineContext {
  target: Target;
  /** ID of the preset the run uses, when it uses one. */
  preset?: string;
  /** The level of the run. An engine can skip its own rules that sit above it. */
  level: number;
  /** Set by a preset that runs Envato's fork of Theme Check, such as envato and its copies. */
  themeCheck?: 'envato';
  signal?: AbortSignal;
  /** Tells the user something while the engine runs, for example that tools are being installed. */
  note(message: string): void;
}

export interface Engine {
  id: string;
  title: string;
  kinds: readonly TargetKind[];
  /** The lowest level that runs the engine. */
  level: number;
  /** Runs only when the user turns experimental checks on, or names the engine. */
  experimental?: true;
  /** Names the variant of its tool the engine runs with these settings. Two runs are compared only when the variants match. */
  variant?(settings: { preset?: string; themeCheck?: 'envato' }): string | undefined;
  run(ctx: EngineContext): Promise<RawFinding[]>;
}

/** A named set of engines with a level and a fail threshold, for one kind of project. */
export interface Preset {
  /** Lowercase letters, digits and hyphens. A user preset is the file of this name in the presets folder. */
  id: string;
  title: string;
  /** One sentence that says what the preset is for. */
  summary: string;
  /** The kinds of target the preset fits. */
  kinds: readonly TargetKind[];
  /** IDs of the engines the preset runs. An ID no engine has is ignored. */
  engines: string[];
  /** The level of a run with this preset, unless the run sets one. */
  level?: number;
  /** The exit threshold of a run with this preset, unless the run sets one. */
  failOn?: Severity | 'never';
  /** Set on the presets that ship with wp-shakedown. */
  builtIn?: true;
  /** Runs Envato's fork of Theme Check in place of the wordpress.org one. A copy of the preset keeps it. */
  themeCheck?: 'envato';
}

/** An engine throws this when it cannot run here, for example when PHP is missing. The run continues. */
export class EngineSkipped extends Error {}

export type EngineStatus = 'ok' | 'skipped' | 'failed';

export interface EngineRun {
  engine: string;
  unit?: string;
  status: EngineStatus;
  durationMs: number;
  findings: number;
  /** Why the engine was skipped or how it failed. */
  reason?: string;
  /** Set when the engine ran a variant of its tool, for example the Envato fork of Theme Check. */
  variant?: string;
}

export interface Summary {
  error: number;
  warning: number;
  info: number;
  suppressed: number;
}

export interface RunResult {
  schema: 1;
  tool: { name: 'wp-shakedown'; version: string };
  target: {
    kind: TargetKind;
    path: string;
    name: string;
    /** `path` here is relative to the root target. */
    units: { kind: TargetKind; name: string; path: string }[];
  };
  /** ID of the preset the run used. Absent when the run used none. */
  preset?: string;
  /** The level of the run. A report written before levels has `depth` and `profile` instead, and readPreviousRun maps them. */
  level?: number;
  /** True when the run had experimental checks on. */
  experimental?: true;
  startedAt: string;
  finishedAt: string;
  engines: EngineRun[];
  findings: Finding[];
  summary: Summary;
  /** Baseline entries that matched no finding in this run. */
  staleBaseline: string[];
}

export type RunEvent =
  | { type: 'run:start'; target: Target; jobs: { engine: string; unit?: string }[] }
  | { type: 'engine:start'; engine: string; unit?: string }
  | { type: 'engine:note'; engine: string; unit?: string; message: string }
  | { type: 'engine:end'; run: EngineRun }
  | { type: 'run:end'; result: RunResult };

export interface BaselineEntry {
  id: string;
  reason: string;
}

export interface Baseline {
  schema: 1;
  entries: BaselineEntry[];
}

export interface RunDiff {
  fixed: Finding[];
  added: Finding[];
  open: Finding[];
}

const FAIL_ON: Record<string, Severity | 'never'> = {
  critical: 'error',
  important: 'warning',
  recommended: 'info',
  error: 'error',
  warning: 'warning',
  info: 'info',
  never: 'never',
};

/** A severity name, old or new, or `never`, becomes the internal value. Throws on anything else. */
export function parseFailOn(v: string): Severity | 'never' {
  const found = Object.hasOwn(FAIL_ON, v) ? FAIL_ON[v] : undefined;
  if (!found) throw new Error('--fail-on must be critical, important, recommended or never.');
  return found;
}
