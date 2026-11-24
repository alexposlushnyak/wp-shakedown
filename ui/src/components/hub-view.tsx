import { FolderPlusIcon, PlayIcon, PlusIcon, SquareIcon } from 'lucide-react';
import { DepthControl } from '@/components/depth-control';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from '@/components/ui/item';
import { Progress } from '@/components/ui/progress';
import type { Depth, Project } from '@/lib/api';
import { lastRunText, plural, progress, projectTone, runModel, timeAgo } from '@/lib/run';
import type { Tone, WireEvent } from '@/lib/run';

const DOT: Record<Tone, { color: string; label: string }> = {
	error: { color: 'bg-destructive', label: 'The last run found errors.' },
	warning: { color: 'bg-amber-500', label: 'The last run found warnings.' },
	clean: { color: 'bg-emerald-500', label: 'The last run was clean.' },
	none: { color: 'bg-muted-foreground/40', label: 'Not run yet.' },
};

function kindText(p: Project): string {
	if (p.kind === 'theme') return 'theme';
	if (p.kind === 'plugin') return 'plugin';
	return `WordPress folder · ${plural(p.units, 'part', 'parts')}`;
}

function Status({ project, events }: { project: Project; events: WireEvent[] }) {
	if (project.run === 'queued') return <span className="text-muted-foreground text-sm">Queued</span>;
	if (project.run === 'running') {
		const model = runModel(events);
		const done = model.jobs.filter((j) => j.status !== 'waiting' && j.status !== 'running').length;
		const current = model.jobs.find((j) => j.status === 'running');
		return (
			<div className="flex w-28 flex-col items-end gap-1">
				<Progress value={progress(model.jobs)} className="w-24" aria-label="Run progress" />
				<span className="text-muted-foreground text-xs tabular-nums">{model.jobs.length === 0 ? 'Starting' : `${done} of ${model.jobs.length}`}</span>
				{current && <span className="text-muted-foreground max-w-full truncate text-xs">{current.engine}</span>}
			</div>
		);
	}
	return (
		<div className="flex flex-col items-end">
			<span className="text-sm">{lastRunText(project.last)}</span>
			{project.last && <span className="text-muted-foreground text-xs">{timeAgo(project.last.finishedAt, Date.now())}</span>}
		</div>
	);
}

function Row({ project, events, onRun, onStop }: { project: Project; events: WireEvent[]; onRun: () => void; onStop: () => void }) {
	const tone = DOT[projectTone(project.last)];
	const active = project.run !== undefined;
	return (
		<Item asChild>
			<a href={`#/p/${project.id}`}>
				<span className={`size-2 shrink-0 rounded-full ${tone.color}`}>
					<span className="sr-only">{tone.label}</span>
				</span>
				<ItemContent className="min-w-0">
					<ItemTitle>{project.name}</ItemTitle>
					<ItemDescription className={project.problem ? 'text-destructive' : ''}>{project.problem ?? kindText(project)}</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Status project={project} events={events} />
					<Button
						variant="ghost"
						size="icon"
						aria-label={active ? `Stop ${project.name}` : `Run ${project.name}`}
						disabled={!active && !project.kind}
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							if (active) onStop();
							else onRun();
						}}
					>
						{active ? <SquareIcon /> : <PlayIcon />}
					</Button>
				</ItemActions>
			</a>
		</Item>
	);
}

interface Props {
	projects: Project[];
	runs: Record<string, WireEvent[]>;
	depth: Depth;
	onDepth: (depth: Depth) => void;
	onRun: (ids: string[]) => void;
	onStop: (id: string) => void;
	onAdd: () => void;
}

export function HubView({ projects, runs, depth, onDepth, onRun, onStop, onAdd }: Props) {
	const runnable = projects.filter((p) => p.kind && !p.run).map((p) => p.id);
	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-lg font-medium">Projects</h1>
				<div className="flex flex-wrap items-center gap-2">
					<DepthControl value={depth} onChange={onDepth} />
					<Button disabled={runnable.length === 0} onClick={() => onRun(runnable)}>
						Run all
					</Button>
					<Button variant="outline" onClick={onAdd}>
						<PlusIcon />
						Add
					</Button>
				</div>
			</div>
			{projects.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<FolderPlusIcon />
						</EmptyMedia>
						<EmptyTitle>No projects yet</EmptyTitle>
						<EmptyDescription>Add the folder of a theme, a plugin or a whole WordPress site.</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button onClick={onAdd}>Add a folder</Button>
					</EmptyContent>
				</Empty>
			) : (
				<ItemGroup className="gap-0">
					{projects.map((p, i) => (
						<div key={p.id}>
							{i > 0 && <ItemSeparator className="my-0" />}
							<Row project={p} events={runs[p.id] ?? []} onRun={() => onRun([p.id])} onStop={() => onStop(p.id)} />
						</div>
					))}
				</ItemGroup>
			)}
		</section>
	);
}
