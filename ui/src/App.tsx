import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CircleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import { AddDialog } from '@/components/add-dialog';
import { AppDock } from '@/components/app-dock';
import { HubView } from '@/components/hub-view';
import { PresetsView } from '@/components/presets-view';
import { ProjectView } from '@/components/project-view';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api, listen, token, upload } from '@/lib/api';
import type { PresetInfo, Project, ServerState } from '@/lib/api';
import { fromSnapshot, parseView, queueText, readLevel, withEvent } from '@/lib/run';
import type { RunEvents } from '@/lib/run';

const STOPPED = 'The run was stopped.';

function savedLevel(): number {
	try {
		// An older page saved a depth name. readLevel turns it into its level.
		return readLevel(localStorage.getItem('level') ?? localStorage.getItem('depth'));
	} catch {
		// Storage can be blocked. The default level is fine then.
		return readLevel(null);
	}
}

function Footer({ version }: { version?: string }) {
	const link = 'underline-offset-4 hover:underline';
	return (
		<footer className="text-muted-foreground mt-auto pt-10 text-xs">
			{version && `wp-shakedown ${version}. `}© {new Date().getFullYear()}{' '}
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
	const [level, setLevelState] = useState<number>(savedLevel);
	const [hash, setHash] = useState(location.hash);
	const [adding, setAdding] = useState(false);
	const [error, setError] = useState(token ? '' : 'Open the link that wp-shakedown printed in the terminal. It carries the access token.');
	const [dragging, setDragging] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);

	const fail = (err: Error) => setError(err.message);
	const loadProjects = useCallback(() => {
		api<{ projects: Project[] }>('/api/projects').then((d) => setProjects(d.projects), fail);
	}, []);

	useEffect(() => {
		// A screen change is a short cross-fade where the browser supports view transitions.
		const onHash = () => {
			const next = location.hash;
			const doc = document as Document & { startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> } };
			// A hidden tab aborts the transition. The screen still changes, so the rejection means nothing.
			if (doc.startViewTransition && !document.hidden) {
				const t = doc.startViewTransition(() => flushSync(() => setHash(next)));
				t.ready.catch(() => {});
				t.finished.catch(() => {});
			} else setHash(next);
		};
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
			presets: () => api<ServerState>('/api/state').then(setInfo, fail),
		});
	}, [loadProjects]);

	function setLevel(next: number) {
		setLevelState(next);
		try {
			localStorage.setItem('level', String(next));
		} catch {
			// The choice then lasts until the page closes.
		}
	}

	function run(ids: string[], preset?: string) {
		setError('');
		api('/api/run', { ids, level, ...(preset ? { preset } : {}) }).then(loadProjects, fail);
	}

	const loadState = () => api<ServerState>('/api/state').then(setInfo, fail);

	async function savePreset(preset: PresetInfo) {
		setError('');
		try {
			const { builtIn: _, ...body } = preset;
			await api('/api/presets', body);
			await loadState();
			toast.success(`Saved ${preset.title}.`);
			location.hash = `#/presets/${encodeURIComponent(preset.id)}`;
		} catch (err) {
			fail(err as Error);
		}
	}

	async function removePreset(id: string) {
		setError('');
		try {
			await api('/api/presets/remove', { id });
			await loadState();
			location.hash = '#/presets';
		} catch (err) {
			fail(err as Error);
		}
	}

	const stop = (id?: string) => api('/api/cancel', id ? { id } : {}).catch(fail);

	async function add(path: string) {
		const { project } = await api<{ project: Project }>('/api/projects', { path });
		loadProjects();
		location.hash = `#/p/${project.id}`;
	}

	async function pick() {
		setError('');
		try {
			const chosen = await api<{ path?: string }>('/api/pick', {});
			if (chosen.path) await add(chosen.path);
		} catch (err) {
			fail(err as Error);
		}
	}

	/** Uploads ZIP files one by one, then queues a run of every project they became. */
	async function uploadAll(files: File[]) {
		const zips = files.filter((f) => f.name.toLowerCase().endsWith('.zip'));
		if (zips.length === 0) return setError('Drop ZIP files of themes or plugins.');
		setError('');
		const ids: string[] = [];
		for (const file of zips) {
			try {
				const { project } = await upload(file);
				ids.push(project.id);
				toast.success(`Added ${project.name}.`);
			} catch (err) {
				fail(err as Error);
			}
		}
		loadProjects();
		if (ids.length > 0) run(ids);
	}

	useEffect(() => {
		// Files dragged over the window show the drop target. Text and links do not.
		const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
		const over = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			setDragging(true);
		};
		const leave = (e: DragEvent) => {
			if (e.relatedTarget === null) setDragging(false);
		};
		const drop = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			setDragging(false);
			void uploadAll([...(e.dataTransfer?.files ?? [])]);
		};
		addEventListener('dragover', over);
		addEventListener('dragleave', leave);
		addEventListener('drop', drop);
		return () => {
			removeEventListener('dragover', over);
			removeEventListener('dragleave', leave);
			removeEventListener('drop', drop);
		};
	});
	const view = parseView(hash, projects.map((p) => p.id));
	const open = view.view === 'project' ? projects.find((p) => p.id === view.id) : undefined;

	return (
		<TooltipProvider delayDuration={300}>
		<div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-5 pt-14 pb-32 sm:px-8">

			{error && (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>That did not work</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{token &&
				(view.view === 'presets' ? (
					<PresetsView id={view.id} presets={info?.presets ?? []} engines={info?.engines ?? []} onSave={savePreset} onRemove={removePreset} />
				) : open ? (
					<ProjectView
						project={open}
						events={runs[open.id] ?? []}
						presets={info?.presets ?? []}
						level={level}
						onLevel={setLevel}
						onRun={(preset) => run([open.id], preset)}
						onStop={() => stop(open.id)}
						onRemove={() => {
							api('/api/projects/remove', { id: open.id }).then(() => {
								location.hash = '#/';
								loadProjects();
							}, fail);
						}}
					/>
				) : (
					<HubView projects={projects} runs={runs} level={level} onLevel={setLevel} onRun={run} onStop={stop} home={info?.home ?? ''} />
				))}

			{info && (
				<AddDialog
					open={adding}
					onOpenChange={setAdding}
					startDir={info.startDir}
					onError={setError}
					onAdd={(path) => add(path).catch((err: Error) => { fail(err); throw err; })}
				/>
			)}

			<Footer version={info?.version} />
			<input
				ref={fileInput}
				type="file"
				accept=".zip,application/zip"
				multiple
				hidden
				onChange={(e) => {
					void uploadAll([...(e.target.files ?? [])]);
					e.target.value = '';
				}}
			/>
			{token && (
				<AppDock
					status={queueText(projects)}
					busy={projects.some((p) => p.run)}
					picker={info?.picker ?? false}
					onPick={pick}
					onUpload={() => fileInput.current?.click()}
					onBrowse={() => setAdding(true)}
					onPresets={() => (location.hash = '#/presets')}
				/>
			)}
			{dragging && (
				<div className="bg-background/85 pointer-events-none fixed inset-0 z-50 grid place-items-center backdrop-blur-sm">
					<p className="text-xl font-medium">Drop ZIP files to add and run them</p>
				</div>
			)}
			<Toaster />
		</div>
		</TooltipProvider>
	);
}
