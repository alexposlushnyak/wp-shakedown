import { useEffect, useState } from 'react';
import { CircleCheckIcon, CircleDashedIcon, CircleSlashIcon, CircleXIcon, SquareIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { jobKey, jobStatusText, progress, seconds } from '@/lib/run';
import type { Job, RunModel } from '@/lib/run';

function StatusIcon({ status }: { status: Job['status'] }) {
	if (status === 'running') return <Spinner />;
	if (status === 'ok') return <CircleCheckIcon className="text-muted-foreground size-4" />;
	if (status === 'skipped') return <CircleSlashIcon className="text-muted-foreground size-4" />;
	if (status === 'failed') return <CircleXIcon className="text-destructive size-4" />;
	return <CircleDashedIcon className="text-muted-foreground/50 size-4" />;
}

function Clock({ running }: { running: boolean }) {
	const [elapsed, setElapsed] = useState(0);
	useEffect(() => {
		if (!running) return;
		const start = Date.now();
		setElapsed(0);
		const timer = setInterval(() => setElapsed(Date.now() - start), 100);
		return () => clearInterval(timer);
	}, [running]);
	return <span className="text-muted-foreground tabular-nums">{seconds(elapsed)}</span>;
}

export function RunCard({ model, onStop }: { model: RunModel; onStop: () => void }) {
	const target = model.target;
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-3">
					Run <Clock running={model.running} />
				</CardTitle>
				{target && (
					<CardDescription className="break-all">
						{target.kind === 'install' ? 'WordPress folder' : target.kind} "{target.name}" at <span className="font-mono">{target.path}</span>
					</CardDescription>
				)}
				{model.running && (
					<CardAction>
						<Button variant="outline" size="sm" onClick={onStop}>
							<SquareIcon />
							Stop
						</Button>
					</CardAction>
				)}
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<Progress value={progress(model.jobs)} aria-label="Run progress" />
				<ol className="flex flex-col divide-y">
					{model.jobs.map((job) => (
						<li key={jobKey(job.engine, job.unit)} className="grid grid-cols-[1.25rem_1fr_auto_3.5rem] items-center gap-x-3 gap-y-1 py-2 text-sm">
							<StatusIcon status={job.status} />
							<span className={job.status === 'waiting' ? 'text-muted-foreground' : 'font-medium'}>
								{job.engine}
								{job.unit && <span className="text-muted-foreground ml-2 font-mono text-xs font-normal">{job.unit}</span>}
							</span>
							<Badge variant={job.status === 'failed' ? 'destructive' : job.status === 'ok' && job.findings > 0 ? 'secondary' : 'outline'}>
								{jobStatusText(job)}
							</Badge>
							<span className="text-muted-foreground text-right tabular-nums">
								{job.status === 'ok' || job.status === 'failed' ? seconds(job.durationMs) : ''}
							</span>
							{(job.notes.length > 0 || job.reason) && (
								<p className="text-muted-foreground col-span-3 col-start-2 text-xs">{[...job.notes, job.reason].filter(Boolean).join(' ')}</p>
							)}
						</li>
					))}
				</ol>
			</CardContent>
		</Card>
	);
}
