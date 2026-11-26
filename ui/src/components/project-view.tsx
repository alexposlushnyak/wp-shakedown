import { useEffect, useState } from 'react';
import { ArrowLeftIcon, ChevronsUpDownIcon, ClipboardIcon, ExternalLinkIcon, PlayIcon, SparklesIcon, SquareIcon } from 'lucide-react';
import { toast } from 'sonner';
import { DepthControl } from '@/components/depth-control';
import { EngineList } from '@/components/engine-line';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api, q, token } from '@/lib/api';
import type { Depth, ProfileInfo, Project, ProjectReport } from '@/lib/api';
import { aiPrompt, plural, profilesFor, progress, runModel, timeAgo } from '@/lib/run';
import type { Job, WireEvent } from '@/lib/run';

async function copy(text: string, done: string) {
	try {
		await navigator.clipboard.writeText(text);
		toast.success(done);
	} catch {
		toast.error('The browser did not allow copying.');
	}
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
	return (
		<div className="flex flex-col gap-1">
			<span className={`text-4xl font-semibold tracking-[-0.02em] tabular-nums ${value > 0 && tone ? tone : ''}`}>{value}</span>
			<span className="text-muted-foreground text-sm">{label}</span>
		</div>
	);
}

function Report({ report, id }: { report: ProjectReport; id: string }) {
	const { summary } = report;
	const failed = report.engines.filter((e) => e.status === 'failed').length;
	const jobs: Job[] = report.engines.map((e) => ({ ...e, reason: e.reason ?? '', notes: [] }));
	const line = [
		`Ran ${timeAgo(report.finishedAt, Date.now())}`,
		report.depth && report.depth !== 'standard' ? `${report.depth} run` : '',
		report.experimental ? 'experimental checks on' : '',
		report.profile ?? '',
	].filter(Boolean);
	const reportFile = report.files[0] ?? '';
	return (
		<div className="flex flex-col gap-4">
			<div className="grid grid-cols-3 gap-6">
				<Tile label="Errors" value={summary.error} tone="text-destructive" />
				<Tile label="Warnings" value={summary.warning} tone="text-warning" />
				<Tile label="Notes" value={summary.info} />
			</div>
			<p className="text-muted-foreground text-sm">
				{line.join(', ')}
				{failed > 0 && (
					<>
						{'. '}
						<span className="text-destructive">{plural(failed, 'engine failed', 'engines failed')}</span>
					</>
				)}
				{report.diff && `. ${report.diff.fixed} fixed, ${report.diff.added} new, ${report.diff.open} still open`}
			</p>
			<Collapsible>
				<CollapsibleTrigger asChild>
					<Button variant="ghost" size="sm" className="-ml-2">
						<ChevronsUpDownIcon />
						{plural(report.engines.length, 'engine', 'engines')}
					</Button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<EngineList jobs={jobs} />
				</CollapsibleContent>
			</Collapsible>
			<div className="flex flex-wrap gap-2">
				<Button variant="outline" asChild>
					<a href={`/api/report.html?id=${id}&t=${q(token)}`} target="_blank" rel="noreferrer">
						<ExternalLinkIcon />
						Open the report
					</a>
				</Button>
				<Button variant="outline" onClick={() => copy(reportFile, 'Path copied.')}>
					<ClipboardIcon />
					Copy the report path
				</Button>
				<Button variant="outline" onClick={() => copy(aiPrompt(reportFile), 'Prompt copied.')}>
					<SparklesIcon />
					Copy a prompt for an assistant
				</Button>
			</div>
		</div>
	);
}

interface Props {
	project: Project;
	events: WireEvent[];
	profiles: ProfileInfo[];
	depth: Depth;
	onDepth: (depth: Depth) => void;
	onRun: (profile: string | undefined, experimental: boolean) => void;
	onStop: () => void;
	onRemove: () => void;
}

export function ProjectView({ project, events, profiles, depth, onDepth, onRun, onStop, onRemove }: Props) {
	const [profile, setProfile] = useState('all');
	const [experimental, setExperimental] = useState(false);
	const [report, setReport] = useState<ProjectReport | null>(null);
	const active = project.run !== undefined;
	const model = runModel(events);
	const fitting = profilesFor(profiles, project.kind);
	const picked = fitting.find((p) => p.id === profile);
	const finishedAt = project.last?.finishedAt;

	useEffect(() => {
		if (active || !finishedAt) {
			setReport(null);
			return;
		}
		api<ProjectReport>(`/api/report?id=${project.id}`).then(setReport, () => setReport(null));
	}, [project.id, active, finishedAt]);

	useEffect(() => setProfile('all'), [project.id]);

	return (
		<section className="flex flex-col gap-8">
			<Button variant="ghost" size="sm" className="text-muted-foreground -ml-2 self-start" asChild>
				<a href="#/">
					<ArrowLeftIcon />
					Projects
				</a>
			</Button>
			<div className="flex min-w-0 flex-col gap-1">
				<h1 className="text-3xl font-semibold tracking-[-0.02em]">{project.name}</h1>
				<p className="text-muted-foreground flex min-w-0 gap-2 text-sm">
					<span className="shrink-0">{project.kind === 'install' ? 'WordPress folder' : (project.kind ?? 'unavailable')}</span>
					<span className="truncate font-mono" title={project.path}>
						{project.path}
					</span>
				</p>
				{project.problem && <p className="text-destructive text-sm">{project.problem}</p>}
			</div>

			<div className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center gap-2">
					{fitting.length > 0 && (
						<Select value={picked ? profile : 'all'} onValueChange={setProfile}>
							<SelectTrigger className="w-56" aria-label="Profile">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All checks</SelectItem>
								{fitting.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										{p.title}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<DepthControl value={depth} onChange={onDepth} />
					{active ? (
						<Button variant="outline" className="ml-auto" onClick={onStop}>
							<SquareIcon />
							Stop
						</Button>
					) : (
						<Button className="ml-auto" disabled={!project.kind} onClick={() => onRun(picked?.id, experimental)}>
							<PlayIcon />
							Run the checks
						</Button>
					)}
				</div>
				{picked && <p className="text-muted-foreground text-xs">{picked.summary}</p>}
				{project.kind === 'theme' && (
					<Label className="text-muted-foreground text-xs font-normal">
						<Switch size="sm" checked={experimental} onCheckedChange={setExperimental} />
						Experimental checks from theme reviews
					</Label>
				)}
			</div>

			{active ? (
				project.run === 'queued' ? (
					<p className="text-muted-foreground text-sm">Queued. The run starts when another one ends.</p>
				) : (
					<div className="flex flex-col gap-3">
						<Progress value={progress(model.jobs)} aria-label="Run progress" />
						<EngineList jobs={model.jobs} />
					</div>
				)
			) : report ? (
				<Report report={report} id={project.id} />
			) : (
				<p className="text-muted-foreground text-sm">No run yet.</p>
			)}

			<Button variant="ghost" size="sm" className="text-muted-foreground self-start" disabled={active} onClick={onRemove}>
				Remove from the list
			</Button>
		</section>
	);
}
