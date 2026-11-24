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
  signal?: AbortSignal;
  /** Tells the user something while the engine runs, for example that tools are being installed. */
  note(message: string): void;
}

export interface Engine {
  id: string;
  title: string;
  kinds: readonly TargetKind[];
  run(ctx: EngineContext): Promise<RawFinding[]>;
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
