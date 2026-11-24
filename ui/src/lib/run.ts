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

/** The profiles that fit a kind of target. */
export function profilesFor<T extends { kinds: string[] }>(profiles: T[], kind: string | undefined): T[] {
	return kind === undefined ? [] : profiles.filter((p) => p.kinds.includes(kind));
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
	return `Read the wp-shakedown report at ${reportFile} and fix the findings, starting with the errors. Run wp-shakedown again when you are done and check that the findings are gone.`;
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
	const parts = [error > 0 ? plural(error, 'error', 'errors') : '', warning > 0 ? plural(warning, 'warning', 'warnings') : ''].filter(Boolean);
	return parts.length > 0 ? parts.join(', ') : 'Clean';
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
