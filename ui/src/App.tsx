import { useCallback, useEffect, useState } from 'react';
import { CircleAlertIcon } from 'lucide-react';
import { AddDialog } from '@/components/add-dialog';
import { HubView } from '@/components/hub-view';
import { ProjectView } from '@/components/project-view';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Toaster } from '@/components/ui/sonner';
import { api, listen, token } from '@/lib/api';
import type { Depth, Project, ServerState } from '@/lib/api';
import { fromSnapshot, parseRoute, withEvent } from '@/lib/run';
import type { RunEvents } from '@/lib/run';

const STOPPED = 'The run was stopped.';

function savedDepth(): Depth {
	try {
		const value = localStorage.getItem('depth');
		if (value === 'quick' || value === 'standard' || value === 'deep') return value;
	} catch {
		// Storage can be blocked. The default depth is fine then.
	}
	return 'standard';
}

function Footer() {
	const link = 'underline-offset-4 hover:underline';
	return (
		<footer className="text-muted-foreground mt-auto pt-6 text-center text-xs">
			© {new Date().getFullYear()}{' '}
			<a className={link} href="https://github.com/alexposlushnyak" target="_blank" rel="noopener">
				alexposlushnyak
			</a>
			. Backed by{' '}
			<a className={link} href="https://jkdevstudio.com" target="_blank" rel="noopener">
				jkdevstudio
			</a>
			.
		</footer>
	);
}

export default function App() {
	const [info, setInfo] = useState<ServerState | null>(null);
	const [projects, setProjects] = useState<Project[]>([]);
	const [runs, setRuns] = useState<RunEvents>({});
	const [depth, setDepthState] = useState<Depth>(savedDepth);
	const [hash, setHash] = useState(location.hash);
	const [adding, setAdding] = useState(false);
	const [error, setError] = useState(token ? '' : 'Open the link that wp-shakedown printed in the terminal. It carries the access token.');

	const fail = (err: Error) => setError(err.message);
	const loadProjects = useCallback(() => {
		api<{ projects: Project[] }>('/api/projects').then((d) => setProjects(d.projects), fail);
	}, []);

	useEffect(() => {
		const onHash = () => setHash(location.hash);
		addEventListener('hashchange', onHash);
		return () => removeEventListener('hashchange', onHash);
	}, []);

	useEffect(() => {
		if (!token) return;
		api<ServerState>('/api/state').then(setInfo, fail);
		loadProjects();
		return listen({
			snapshot: (list) => setRuns(fromSnapshot(list)),
			run: (id, event) => {
				setRuns((prev) => withEvent(prev, id, event));
				if (event.type === 'run:error' && event.message !== STOPPED) setError(event.message);
			},
			projects: loadProjects,
		});
	}, [loadProjects]);

	function setDepth(next: Depth) {
		setDepthState(next);
		try {
			localStorage.setItem('depth', next);
		} catch {
			// The choice then lasts until the page closes.
		}
	}

	function run(ids: string[], profile?: string, experimental?: boolean) {
		setError('');
		api('/api/run', { ids, depth, ...(profile ? { profile } : {}), ...(experimental ? { experimental: true } : {}) }).then(loadProjects, fail);
	}

	const stop = (id?: string) => api('/api/cancel', id ? { id } : {}).catch(fail);
	const openId = parseRoute(hash, projects.map((p) => p.id));
	const open = projects.find((p) => p.id === openId);

	return (
		<div className="mx-auto flex min-h-svh max-w-2xl flex-col gap-6 p-4 sm:p-6">
			<header className="flex items-center justify-between">
				<span className="text-lg tracking-tight" aria-label="wp-shakedown">
					<span className="font-light">wp</span>
					<span className="font-bold">shakedown</span>
				</span>
				{info && <Badge variant="outline">{info.version}</Badge>}
			</header>

			{error && (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>That did not work</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{token &&
				(open ? (
					<ProjectView
						project={open}
						events={runs[open.id] ?? []}
						profiles={info?.profiles ?? []}
						depth={depth}
						onDepth={setDepth}
						onRun={(profile, experimental) => run([open.id], profile, experimental)}
						onStop={() => stop(open.id)}
						onRemove={() => {
							api('/api/projects/remove', { id: open.id }).then(() => {
								location.hash = '#/';
								loadProjects();
							}, fail);
						}}
					/>
				) : (
					<HubView projects={projects} runs={runs} depth={depth} onDepth={setDepth} onRun={run} onStop={stop} onAdd={() => setAdding(true)} />
				))}

			{info && (
				<AddDialog
					open={adding}
					onOpenChange={setAdding}
					startDir={info.startDir}
					onError={setError}
					onAdd={(path) => api('/api/projects', { path }).then(loadProjects, (err: Error) => { fail(err); throw err; })}
				/>
			)}

			<Footer />
			<Toaster />
		</div>
	);
}
