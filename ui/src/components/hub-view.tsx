import { PlayIcon, SquareIcon } from 'lucide-react';
import { DepthControl } from '@/components/depth-control';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Progress } from '@/components/ui/progress';
import type { Depth, Project } from '@/lib/api';
import { groupProjects, lastRunText, plural, progress, projectTone, runModel, shortPath, timeAgo } from '@/lib/run';
import { cn } from '@/lib/utils';
import type { Tone, WireEvent } from '@/lib/run';

const DOT: Record<Tone, { color: string; label: string }> = {
	error: { color: 'bg-destructive', label: 'The last run found errors.' },
	warning: { color: 'bg-warning', label: 'The last run found warnings.' },
	clean: { color: 'bg-success', label: 'The last run was clean.' },
	none: { color: 'bg-muted-foreground/40', label: 'Not run yet.' },
};

function kindText(p: Project, home: string): string {
	if (p.kind === 'install') return `${plural(p.units, 'theme or plugin', 'themes and plugins')} inside`;
	return shortPath(p.path, home);
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
			<span className={cn('text-sm', !project.last && 'text-muted-foreground')}>{lastRunText(project.last)}</span>
			{project.last && <span className="text-muted-foreground text-xs">{timeAgo(project.last.finishedAt, Date.now())}</span>}
		</div>
	);
}

function Row({ project, home, events, onRun, onStop }: { project: Project; home: string; events: WireEvent[]; onRun: () => void; onStop: () => void }) {
	const tone = DOT[projectTone(project.last)];
	const active = project.run !== undefined;
	return (
		<Item asChild className="hover:bg-accent/60 -mx-3 rounded-xl px-3 py-3 transition-colors duration-100">
			<a href={`#/p/${project.id}`}>
				<span className={`size-2 shrink-0 rounded-full ${tone.color}`}>
					<span className="sr-only">{tone.label}</span>
				</span>
				<ItemContent className="min-w-0">
					<ItemTitle className="text-[15px]">{project.name}</ItemTitle>
					<ItemDescription className={project.problem ? 'text-destructive' : 'truncate'} title={project.problem ? undefined : project.path}>
						{project.problem ?? kindText(project, home)}
					</ItemDescription>
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
	home: string;
}

export function HubView({ projects, runs, depth, onDepth, onRun, onStop, home }: Props) {
	const runnable = projects.filter((p) => p.kind && !p.run).map((p) => p.id);
	return (
		<section className="flex flex-col gap-10">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<h1 className="text-3xl font-semibold tracking-[-0.02em]">Projects</h1>
				<div className="flex flex-wrap items-center gap-2">
					<DepthControl value={depth} onChange={onDepth} />
					<Button disabled={runnable.length === 0} onClick={() => onRun(runnable)}>
						<PlayIcon />
						Run all
					</Button>
				</div>
			</div>
			{projects.length === 0 ? (
				<Empty className="py-16">
					<EmptyHeader>
						<EmptyTitle className="text-lg">No projects yet</EmptyTitle>
						<EmptyDescription>Add the folder of a theme, a plugin or a whole WordPress site with the button below, or drop ZIP files anywhere on this page.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				groupProjects(projects).map((g) => (
					<section key={g.title} aria-labelledby={`group-${g.title.replace(/ /g, '-')}`} className="flex flex-col gap-1">
						<h2 id={`group-${g.title.replace(/ /g, '-')}`} className="text-muted-foreground flex items-baseline gap-2 text-sm font-medium">
							{g.title}
							<span className="text-muted-foreground/60 tabular-nums">{g.projects.length}</span>
						</h2>
						<ItemGroup className="gap-0">
							{g.projects.map((p) => (
								<Row key={p.id} project={p} home={home} events={runs[p.id] ?? []} onRun={() => onRun([p.id])} onStop={() => onStop(p.id)} />
							))}
						</ItemGroup>
					</section>
				))
			)}
		</section>
	);
}
