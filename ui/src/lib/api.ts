import type { Finding, Summary, WireEvent } from '@/lib/run';

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
	running: boolean;
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

export interface Report {
	result: { summary: Summary; findings: Finding[]; staleBaseline: string[] };
	diff?: { fixed: Finding[]; added: Finding[]; open: Finding[] };
	files: string[];
	dir: string;
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
export function listen(onSnapshot: (events: WireEvent[], running: boolean) => void, onEvent: (event: WireEvent) => void): () => void {
	const source = new EventSource(`/api/events?t=${q(token)}`);
	source.addEventListener('snapshot', (e) => {
		const data = JSON.parse((e as MessageEvent<string>).data) as { running: boolean; events: WireEvent[] };
		onSnapshot(data.events, data.running);
	});
	source.addEventListener('run', (e) => onEvent(JSON.parse((e as MessageEvent<string>).data) as WireEvent));
	return () => source.close();
}
