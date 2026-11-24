import type { JobStatus, Summary, WireEvent } from '@/lib/run';

// The token arrives in the link the terminal printed. Keep it for this tab and take it out of the address bar.
const params = new URLSearchParams(location.search);
export const token = params.get('t') ?? sessionStorage.getItem('token') ?? '';
if (params.has('t')) {
	sessionStorage.setItem('token', token);
	history.replaceState(null, '', location.pathname);
}

export interface EngineInfo {
	id: string;
	title: string;
	kinds: string[];
}

export interface ProfileInfo {
	id: string;
	title: string;
	summary: string;
	kinds: string[];
}

export interface ServerState {
	version: string;
	home: string;
	startDir: string;
	engines: EngineInfo[];
	profiles: ProfileInfo[];
}

export interface Detected {
	kind: string;
	name: string;
	path: string;
	units: { kind: string; name: string; path: string }[];
}

export interface Dirs {
	path: string;
	parent: string | null;
	dirs: { name: string; path: string }[];
}

export type Depth = 'quick' | 'standard' | 'deep';

export interface Project {
	id: string;
	path: string;
	name: string;
	kind?: 'theme' | 'plugin' | 'install';
	units: number;
	problem?: string;
	last?: { finishedAt: string; summary: Summary; failed: number; profile?: string; depth?: Depth; dir: string };
	run?: 'queued' | 'running';
}

export interface ProjectReport {
	summary: Summary;
	engines: { engine: string; unit?: string; status: Exclude<JobStatus, 'waiting' | 'running'>; durationMs: number; findings: number; reason?: string }[];
	finishedAt: string;
	profile?: string;
	depth?: Depth;
	diff?: { fixed: number; added: number; open: number };
	files: string[];
	dir: string;
}

export interface RunSnapshot {
	id: string;
	state: 'queued' | 'running' | 'ended';
	events: WireEvent[];
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
	const res = await fetch(path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'x-shakedown-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const data = (await res.json().catch(() => ({}))) as { error?: string };
	if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
	return data as T;
}

export const q = (path: string): string => encodeURIComponent(path);

/** Opens the event stream. The server sends what happened so far first, then each new event. */
export function listen(on: {
	snapshot: (runs: RunSnapshot[]) => void;
	run: (id: string, event: WireEvent) => void;
	projects: () => void;
}): () => void {
	const source = new EventSource(`/api/events?t=${q(token)}`);
	const data = <T>(e: Event) => JSON.parse((e as MessageEvent<string>).data) as T;
	source.addEventListener('snapshot', (e) => on.snapshot(data<{ runs: RunSnapshot[] }>(e).runs));
	source.addEventListener('run', (e) => {
		const { id, event } = data<{ id: string; event: WireEvent }>(e);
		on.run(id, event);
	});
	source.addEventListener('projects', () => on.projects());
	return () => source.close();
}
