import { CircleCheckIcon, CircleDashedIcon, CircleSlashIcon, CircleXIcon } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { groupJobs, jobKey, jobStatusText } from '@/lib/run';
import type { Job } from '@/lib/run';

function StatusIcon({ status }: { status: Job['status'] }) {
	if (status === 'running') return <Spinner />;
	if (status === 'ok') return <CircleCheckIcon className="text-muted-foreground size-4" />;
	if (status === 'skipped') return <CircleSlashIcon className="text-muted-foreground size-4" />;
	if (status === 'failed') return <CircleXIcon className="text-destructive size-4" />;
	return <CircleDashedIcon className="text-muted-foreground/50 size-4" />;
}

function Lines({ jobs, showUnit }: { jobs: Job[]; showUnit: boolean }) {
	return (
		<ol className="flex flex-col divide-y">
			{jobs.map((job) => (
				<li key={jobKey(job.engine, job.unit)} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 gap-y-1 py-2 text-sm">
					<StatusIcon status={job.status} />
					<span className={job.status === 'waiting' ? 'text-muted-foreground' : 'font-medium'}>
						{job.engine}
						{showUnit && job.unit && <span className="text-muted-foreground ml-2 font-mono text-xs font-normal">{job.unit}</span>}
					</span>
					<span className={job.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{jobStatusText(job)}</span>
					{(job.notes.length > 0 || job.reason) && (
						<p className="text-muted-foreground col-span-2 col-start-2 text-xs">{[...job.notes, job.reason].filter(Boolean).join(' ')}</p>
					)}
				</li>
			))}
		</ol>
	);
}

/** A WordPress folder runs the same engines on each theme and plugin, so its lines come in one group per part. */
export function EngineList({ jobs }: { jobs: Job[] }) {
	const groups = groupJobs(jobs);
	if (groups.length < 2) return <Lines jobs={jobs} showUnit />;
	return (
		<div className="flex flex-col gap-4">
			{groups.map((g) => {
				const done = g.jobs.filter((j) => j.status !== 'waiting' && j.status !== 'running').length;
				return (
					<section key={g.unit ?? ''} aria-label={g.unit ?? 'The folder'}>
						<h3 className="text-muted-foreground flex justify-between text-xs">
							<span className={g.unit ? 'font-mono' : undefined}>{g.unit ?? 'The folder'}</span>
							<span className="tabular-nums">
								{done} of {g.jobs.length}
							</span>
						</h3>
						<Lines jobs={g.jobs} showUnit={false} />
					</section>
				);
			})}
		</div>
	);
}
