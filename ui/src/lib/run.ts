// Pure logic for the page. No DOM and no React in here, so the root test suite can import the file.

export type Severity = 'error' | 'warning' | 'info';

export interface Summary {
	error: number;
	warning: number;
	info: number;
	suppressed: number;
}

export interface Finding {
	id: string;
	engine: string;
	rule: string;
	severity: Severity;
	category: string;
	message: string;
	location: { file?: string; line?: number; column?: number; url?: string; selector?: string };
	hint?: string;
	docs?: string;
	unit?: string;
	suppressed?: { reason: string };
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

export interface Filter {
	severity?: Severity | '';
	engine?: string;
	category?: string;
	text?: string;
	style?: boolean;
}

export function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

export function summaryText(s: Summary): string {
	const base = `${plural(s.error, 'error', 'errors')}, ${plural(s.warning, 'warning', 'warnings')}, ${plural(s.info, 'note', 'notes')}.`;
	return s.suppressed > 0 ? `${base} ${s.suppressed} suppressed.` : base;
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

export function isStyle(f: { category: string }): boolean {
	return f.category === 'standards';
}

export function filterFindings(findings: Finding[], filter: Filter): Finding[] {
	const text = (filter.text ?? '').trim().toLowerCase();
	return findings.filter((f) => {
		if (f.suppressed) return false;
		if (!filter.style && isStyle(f)) return false;
		if (filter.severity && f.severity !== filter.severity) return false;
		if (filter.engine && f.engine !== filter.engine) return false;
		if (filter.category && f.category !== filter.category) return false;
		if (!text) return true;
		return [f.message, f.rule, f.location.file ?? f.location.url ?? '', f.id].some((v) => v.toLowerCase().includes(text));
	});
}

export function groupByFile(findings: Finding[]): { file: string; items: Finding[] }[] {
	const groups = new Map<string, Finding[]>();
	for (const f of findings) {
		const name = f.location.file ?? f.location.url ?? '(no file)';
		const g = groups.get(name);
		if (g) g.push(f);
		else groups.set(name, [f]);
	}
	return [...groups].map(([file, items]) => ({ file, items }));
}

export function styleCounts(findings: Finding[]): { rule: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const f of findings) {
		if (f.suppressed || !isStyle(f)) continue;
		const rule = `${f.engine}: ${f.rule}`;
		counts.set(rule, (counts.get(rule) ?? 0) + 1);
	}
	return [...counts].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count || (a.rule < b.rule ? -1 : 1));
}

/** Counts for the severity tabs, without style findings unless they are listed. */
export function severityCounts(findings: Finding[], style: boolean): Record<Severity, number> {
	const counts = { error: 0, warning: 0, info: 0 };
	for (const f of findings) {
		if (f.suppressed || (!style && isStyle(f))) continue;
		counts[f.severity]++;
	}
	return counts;
}

export function distinct(findings: Finding[], key: 'engine' | 'category'): string[] {
	return [...new Set(findings.filter((f) => !f.suppressed).map((f) => f[key]))].sort();
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
