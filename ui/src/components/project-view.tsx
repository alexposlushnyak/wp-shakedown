import { useEffect, useState } from 'react';
import { ArrowLeftIcon, ChevronsUpDownIcon, ClipboardIcon, ExternalLinkIcon, HistoryIcon, PlayIcon, SparklesIcon, SquareIcon } from 'lucide-react';
import { toast } from 'sonner';
import { LevelControl } from '@/components/level-control';
import { EngineList } from '@/components/engine-line';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, q, token } from '@/lib/api';
import type { PresetInfo, Project, ProjectReport, RunEntry } from '@/lib/api';
import { aiPrompt, countsText, defaultPair, levelLabel, newerFirst, plural, presetsFor, progress, runLink, runModel, runStamp, timeAgo } from '@/lib/run';
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

function RunOption({ run }: { run: RunEntry }) {
	return (
		<>
			{runStamp(run.finishedAt)} <span className="text-muted-foreground tabular-nums">{countsText(run.summary)}</span>
		</>
	);
}

function History({ runs, id }: { runs: RunEntry[]; id: string }) {
	const pair = defaultPair(runs);
	const [b, setB] = useState(pair?.b ?? '');
	const [a, setA] = useState(pair?.a ?? '');
	const [newer, older] = newerFirst(runs, b, a);
	// A new run changes the list. Start the comparison over from the two newest.
	useEffect(() => {
		const next = defaultPair(runs);
		if (next) {
			setB(next.b);
			setA(next.a);
		}
	}, [runs]);
	return (
		<Collapsible>
			<CollapsibleTrigger asChild>
				<Button variant="ghost" size="sm" className="-ml-2">
					<HistoryIcon />
					{plural(runs.length, 'run', 'runs')}
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent className="flex flex-col gap-4 pt-2">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-muted-foreground text-sm">Compare</span>
					<Select value={b} onValueChange={setB}>
						<SelectTrigger className="w-auto" aria-label="Newer run">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{runs.map((r) => (
								<SelectItem key={r.run} value={r.run}>
									<RunOption run={r} />
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<span className="text-muted-foreground text-sm">with</span>
					<Select value={a} onValueChange={setA}>
						<SelectTrigger className="w-auto" aria-label="Older run">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{runs.map((r) => (
								<SelectItem key={r.run} value={r.run}>
									<RunOption run={r} />
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button variant="outline" asChild={a !== b} disabled={a === b}>
						{a === b ? (
							<span>Open the comparison</span>
						) : (
							<a href={runLink(id, newer, token, older)} target="_blank" rel="noreferrer">
								Open the comparison
							</a>
						)}
					</Button>
				</div>
				<ItemGroup className="gap-0">
					{runs.map((r, i) => {
						const detail = [runStamp(r.finishedAt), r.level !== undefined ? levelLabel(r.level).toLowerCase() : '', r.preset ? `preset ${r.preset}` : ''].filter(Boolean);
						return (
							<Item key={r.run} className="-mx-3 rounded-xl px-3 py-2">
								<ItemContent className="min-w-0">
									<ItemTitle>
										{timeAgo(r.finishedAt, Date.now())}
										{i === 0 && <span className="text-muted-foreground text-xs font-normal">Latest</span>}
									</ItemTitle>
									{detail.length > 0 && <ItemDescription>{detail.join(', ')}</ItemDescription>}
								</ItemContent>
								<ItemActions>
									<span className="text-sm tabular-nums">
										<span className={r.summary.error > 0 ? 'text-destructive' : 'text-muted-foreground'}>{r.summary.error}</span>
										{' / '}
										<span className={r.summary.warning > 0 ? 'text-warning' : 'text-muted-foreground'}>{r.summary.warning}</span>
										{' / '}
										<span className="text-muted-foreground">{r.summary.info}</span>
									</span>
									<Button variant="ghost" size="icon" asChild aria-label={`Open the report of ${runStamp(r.finishedAt)}`}>
										<a href={runLink(id, r.run, token)} target="_blank" rel="noreferrer">
											<ExternalLinkIcon />
										</a>
									</Button>
								</ItemActions>
							</Item>
						);
					})}
				</ItemGroup>
			</CollapsibleContent>
		</Collapsible>
	);
}

function Report({ report, id, runs }: { report: ProjectReport; id: string; runs: RunEntry[] }) {
	const { summary } = report;
	const failed = report.engines.filter((e) => e.status === 'failed').length;
	const jobs: Job[] = report.engines.map((e) => ({ ...e, reason: e.reason ?? '', notes: [] }));
	const line = [
		`Ran ${timeAgo(report.finishedAt, Date.now())}`,
		report.level !== undefined ? levelLabel(report.level).toLowerCase() : '',
		report.preset ? `preset ${report.preset}` : '',
	].filter(Boolean);
	const reportFile = report.files[0] ?? '';
	return (
		<div className="flex flex-col gap-4">
			<div className="grid grid-cols-3 gap-6">
				<Tile label="Critical" value={summary.error} tone="text-destructive" />
				<Tile label="Important" value={summary.warning} tone="text-warning" />
				<Tile label="Recommended" value={summary.info} />
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
			{runs.length >= 2 && <History runs={runs} id={id} />}
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
	presets: PresetInfo[];
	level: number;
	onLevel: (level: number) => void;
	onRun: (preset: string | undefined) => void;
	onStop: () => void;
	onRemove: () => void;
}

export function ProjectView({ project, events, presets, level, onLevel, onRun, onStop, onRemove }: Props) {
	const [preset, setPreset] = useState('all');
	const [report, setReport] = useState<ProjectReport | null>(null);
	const [runs, setRuns] = useState<RunEntry[]>([]);
	const active = project.run !== undefined;
	const model = runModel(events);
	const fitting = presetsFor(presets, project.kind);
	const picked = fitting.find((p) => p.id === preset);
	const finishedAt = project.last?.finishedAt;

	useEffect(() => {
		if (active || !finishedAt) {
			setReport(null);
			setRuns([]);
			return;
		}
		api<ProjectReport>(`/api/report?id=${project.id}`).then(setReport, () => setReport(null));
		api<{ runs: RunEntry[] }>(`/api/history?id=${project.id}`).then((h) => setRuns(h.runs), () => setRuns([]));
	}, [project.id, active, finishedAt]);

	useEffect(() => setPreset('all'), [project.id]);

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
						<Select
							value={picked ? preset : 'all'}
							onValueChange={(id) => {
								setPreset(id);
								// A preset brings its level. The slider still lets you change it before the run.
								const level = fitting.find((p) => p.id === id)?.level;
								if (level !== undefined) onLevel(level);
							}}
						>
							<SelectTrigger className="w-56" aria-label="Preset">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Every engine at this level</SelectItem>
								{fitting.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										{p.title}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<LevelControl value={level} onChange={onLevel} />
					{active ? (
						<Button variant="outline" className="ml-auto" onClick={onStop}>
							<SquareIcon />
							Stop
						</Button>
					) : (
						<Button className="ml-auto" disabled={!project.kind} onClick={() => onRun(picked?.id)}>
							<PlayIcon />
							Run the checks
						</Button>
					)}
				</div>
				{picked && <p className="text-muted-foreground text-xs">{picked.summary}</p>}
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
				<Report report={report} id={project.id} runs={runs} />
			) : (
				<p className="text-muted-foreground text-sm">No run yet.</p>
			)}

			<Button variant="ghost" size="sm" className="text-muted-foreground self-start" disabled={active} onClick={onRemove}>
				Remove from the list
			</Button>
		</section>
	);
}
