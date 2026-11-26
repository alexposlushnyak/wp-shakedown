// Pure logic for the page. No DOM and no React in here, so the root test suite can import the file.

export interface Summary {
	error: number;
	warning: number;
	info: number;
	suppressed: number;
}

export type JobStatus = 'waiting' | 'running' | 'ok' | 'skipped' | 'failed';

export interface Job {
	engine: string;
	unit?: string;
	status: JobStatus;
	findings: number;
	durationMs: number;
	reason: string;
	notes: string[];
}

export interface RunTarget {
	kind: string;
	name: string;
	path: string;
	units: number;
}

export type WireEvent =
	| { type: 'run:start'; target: RunTarget; jobs: { engine: string; unit?: string }[] }
	| { type: 'engine:start'; engine: string; unit?: string }
	| { type: 'engine:note'; engine: string; unit?: string; message: string }
	| { type: 'engine:end'; run: { engine: string; unit?: string; status: 'ok' | 'skipped' | 'failed'; durationMs: number; findings: number; reason?: string } }
	| { type: 'run:end'; summary: Summary; finishedAt: string }
	| { type: 'run:error'; message: string };

export interface RunModel {
	started: boolean;
	running: boolean;
	target: RunTarget | null;
	jobs: Job[];
	summary: Summary | null;
	error: string | null;
}

export function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

export function seconds(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

export function jobKey(engine: string, unit?: string): string {
	return `${engine}\n${unit ?? ''}`;
}

export function detectedText(d: { kind: string; name: string; units: { kind: string }[] }): string {
	if (d.kind === 'theme') return `Theme "${d.name}"`;
	if (d.kind === 'plugin') return `Plugin "${d.name}"`;
	if (d.kind === 'install') {
		const themes = d.units.filter((u) => u.kind === 'theme').length;
		const plugins = d.units.filter((u) => u.kind === 'plugin').length;
		return `WordPress folder with ${plural(themes, 'theme', 'themes')} and ${plural(plugins, 'plugin', 'plugins')}`;
	}
	return `Site ${d.name}`;
}

/** The presets that fit a kind of target. */
export function presetsFor<T extends { kinds: string[] }>(presets: T[], kind: string | undefined): T[] {
	return kind === undefined ? [] : presets.filter((p) => p.kinds.includes(kind));
}

export const LEVEL_NAMES: Record<number, string> = { 3: 'quick', 6: 'standard', 8: 'deep' };
export const DEFAULT_LEVEL = 6;

/** "Level 6, standard" where a level has a name, "Level 7" where it has none. */
export function levelLabel(level: number): string {
	return LEVEL_NAMES[level] ? `Level ${level}, ${LEVEL_NAMES[level]}` : `Level ${level}`;
}

/** A stored level: a number from 0 to 10, or a depth name saved by an older page. Anything else is the default. */
export function readLevel(value: string | null): number {
	const named = Object.entries(LEVEL_NAMES).find(([, name]) => name === value);
	if (named) return Number(named[0]);
	const n = Number(value);
	return value !== null && value !== '' && Number.isInteger(n) && n >= 0 && n <= 10 ? n : DEFAULT_LEVEL;
}

/** A preset ID made from a title: lowercase letters, digits and dashes. */
export function presetId(title: string): string {
	return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** `base`, or `base-2`, `base-3` and so on: the first that is not in `taken`. */
export function freeId(base: string, taken: string[]): string {
	if (!taken.includes(base)) return base;
	for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

/** The view for an address hash. */
export function parseView(hash: string, ids: string[]): { view: 'hub' } | { view: 'project'; id: string } | { view: 'presets'; id?: string } {
	const preset = /^#\/presets(?:\/([^/]+))?$/.exec(hash);
	if (preset) return preset[1] ? { view: 'presets', id: decodeURIComponent(preset[1]) } : { view: 'presets' };
	const id = parseRoute(hash, ids);
	return id ? { view: 'project', id } : { view: 'hub' };
}

/** The jobs of the folder itself first, then one group per theme or plugin, in the order the run lists them. */
export function groupJobs(jobs: Job[]): { unit?: string; jobs: Job[] }[] {
	const groups: { unit?: string; jobs: Job[] }[] = [];
	for (const job of jobs) {
		const group = groups.find((g) => g.unit === job.unit);
		if (group) group.jobs.push(job);
		else groups.push(job.unit === undefined ? { jobs: [job] } : { unit: job.unit, jobs: [job] });
	}
	return groups.sort((a, b) => (a.unit === undefined ? 0 : 1) - (b.unit === undefined ? 0 : 1));
}

/** Builds the state of the run card from the events the server sent. */
export function runModel(events: WireEvent[]): RunModel {
	const model: RunModel = { started: false, running: false, target: null, jobs: [], summary: null, error: null };
	const byKey = new Map<string, Job>();
	for (const e of events) {
		if (e.type === 'run:start') {
			model.started = true;
			model.running = true;
			model.target = e.target;
			model.summary = null;
			model.error = null;
			model.jobs = e.jobs.map((j) => ({ engine: j.engine, ...(j.unit ? { unit: j.unit } : {}), status: 'waiting', findings: 0, durationMs: 0, reason: '', notes: [] }));
			byKey.clear();
			for (const j of model.jobs) byKey.set(jobKey(j.engine, j.unit), j);
		} else if (e.type === 'engine:start') {
			const j = byKey.get(jobKey(e.engine, e.unit));
			if (j) j.status = 'running';
		} else if (e.type === 'engine:note') {
			byKey.get(jobKey(e.engine, e.unit))?.notes.push(e.message);
		} else if (e.type === 'engine:end') {
			const j = byKey.get(jobKey(e.run.engine, e.run.unit));
			if (j) Object.assign(j, { status: e.run.status, findings: e.run.findings, durationMs: e.run.durationMs, reason: e.run.reason ?? '' });
		} else if (e.type === 'run:end') {
			model.running = false;
			model.summary = e.summary;
		} else if (e.type === 'run:error') {
			model.running = false;
			model.error = e.message;
			for (const j of model.jobs) if (j.status === 'running') j.status = 'waiting';
		}
	}
	return model;
}

export function jobStatusText(job: Job): string {
	if (job.status === 'waiting') return 'Waiting';
	if (job.status === 'running') return 'Running';
	if (job.status === 'ok') return plural(job.findings, 'finding', 'findings');
	if (job.status === 'skipped') return 'Skipped';
	return 'Failed';
}

/** How much of the run is done, in percent. */
export function progress(jobs: Job[]): number {
	if (jobs.length === 0) return 0;
	const done = jobs.filter((j) => j.status === 'ok' || j.status === 'skipped' || j.status === 'failed').length;
	return Math.round((done / jobs.length) * 100);
}

export function aiPrompt(reportFile: string): string {
	return `Read the wp-shakedown report at ${reportFile} and fix the findings, starting with the critical ones. Run wp-shakedown again when you are done and check that the findings are gone.`;
}

/** Splits an absolute path into the parts of a breadcrumb. */
export function crumbs(p: string): { name: string; path: string }[] {
	const win = /^[A-Za-z]:\\/.test(p);
	const sep = win ? '\\' : '/';
	const out = win ? [] : [{ name: '/', path: '/' }];
	let acc = '';
	p.split(sep)
		.filter(Boolean)
		.forEach((part, i) => {
			if (!win) acc = `${acc}/${part}`;
			else if (i === 0) acc = `${part}\\`;
			else acc = acc.endsWith('\\') ? `${acc}${part}` : `${acc}\\${part}`;
			out.push({ name: part, path: acc });
		});
	return out;
}

export type Tone = 'error' | 'warning' | 'clean' | 'none';

interface Last {
	summary: Summary;
	failed: number;
}

/** The color of a project's status dot: what its last run found. */
export function projectTone(last: Last | undefined): Tone {
	if (!last) return 'none';
	if (last.summary.error > 0 || last.failed > 0) return 'error';
	return last.summary.warning > 0 ? 'warning' : 'clean';
}

/** What a project row says about its last run. Notes stay out. */
export function lastRunText(last: Last | undefined): string {
	if (!last) return 'Not run yet';
	const { error, warning } = last.summary;
	const parts = [error > 0 ? `${error} critical` : '', warning > 0 ? `${warning} important` : ''].filter(Boolean);
	return parts.length > 0 ? parts.join(', ') : 'Clean';
}

/** The groups of the hub, in the order the command line lists them. Projects that cannot be tested come last. */
export function groupProjects<T extends { kind?: string }>(projects: T[]): { title: string; projects: T[] }[] {
	const groups: [string | undefined, string][] = [
		['theme', 'Themes'],
		['plugin', 'Plugins'],
		['install', 'WordPress folders'],
		[undefined, 'Cannot be tested'],
	];
	const known = groups.map(([kind]) => kind).filter(Boolean);
	// Any other kind goes to the last group, so no project drops out of the list.
	const fits = (p: T, kind: string | undefined) => (kind === undefined ? !known.includes(p.kind) : p.kind === kind);
	return groups.map(([kind, title]) => ({ title, projects: projects.filter((p) => fits(p, kind)) })).filter((g) => g.projects.length > 0);
}

/** The status line of the dock: what runs and what waits. */
export function queueText(projects: { run?: 'queued' | 'running' }[]): string {
	const running = projects.filter((p) => p.run === 'running').length;
	const queued = projects.filter((p) => p.run === 'queued').length;
	if (running === 0 && queued === 0) return 'Idle';
	return [running > 0 ? `${running} running` : '', queued > 0 ? `${queued} queued` : ''].filter(Boolean).join(', ');
}

/** A path with the home folder written as ~, the way a terminal shows it. */
export function shortPath(p: string, home: string): string {
	return home && (p === home || p.startsWith(home + '/')) ? '~' + p.slice(home.length) : p;
}

export function timeAgo(iso: string, now: number): string {
	const minutes = Math.floor((now - Date.parse(iso)) / 60000);
	if (!(minutes >= 1)) return 'just now';
	if (minutes < 60) return `${minutes} min ago`;
	if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
	return `${Math.floor(minutes / 60 / 24)} d ago`;
}

/** The view for an address hash: a project ID, or undefined for the hub. */
export function parseRoute(hash: string, ids: string[]): string | undefined {
	const id = /^#\/p\/([^/]+)$/.exec(hash)?.[1];
	return id && ids.includes(id) ? id : undefined;
}

export type RunEvents = Record<string, WireEvent[]>;

/** Adds an event to the events of one run. A run:start begins that run again. */
export function withEvent(runs: RunEvents, id: string, event: WireEvent): RunEvents {
	return { ...runs, [id]: event.type === 'run:start' ? [event] : [...(runs[id] ?? []), event] };
}

export function fromSnapshot(snapshot: { id: string; events: WireEvent[] }[]): RunEvents {
	return Object.fromEntries(snapshot.map((r) => [r.id, r.events]));
}
