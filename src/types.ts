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

/** How thorough a run is. Each depth runs everything the one before it runs. */
export const DEPTHS = ['quick', 'standard', 'deep'] as const;
export type Depth = (typeof DEPTHS)[number];

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
  /** The lightest depth that runs the engine. Absent means standard. */
  depth?: Depth;
  /** Runs only when the user turns experimental checks on, or names the engine. */
  experimental?: true;
  run(ctx: EngineContext): Promise<RawFinding[]>;
}

/** The engines that matter for one gate, for example the theme directory of wordpress.org. */
export interface Profile {
  id: string;
  title: string;
  /** One sentence that says what the profile is for. */
  summary: string;
  /** The kinds of target the profile fits. */
  kinds: readonly TargetKind[];
  /** IDs of the engines the profile runs. */
  engines: readonly string[];
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
  /** ID of the profile the run used. Absent when the run used none. */
  profile?: string;
  /** Absent in a report written before depth existed. Read that as standard. */
  depth?: Depth;
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
