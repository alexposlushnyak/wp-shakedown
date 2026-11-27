import { CircleCheckIcon, CircleDashedIcon, CircleSlashIcon, CircleXIcon } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { jobStatusText } from '@/lib/run';
import type { Job } from '@/lib/run';

function StatusIcon({ status }: { status: Job['status'] }) {
	if (status === 'running') return <Spinner />;
	if (status === 'ok') return <CircleCheckIcon className="text-muted-foreground size-4" />;
	if (status === 'skipped') return <CircleSlashIcon className="text-muted-foreground size-4" />;
	if (status === 'failed') return <CircleXIcon className="text-destructive size-4" />;
	return <CircleDashedIcon className="text-muted-foreground/50 size-4" />;
}

export function EngineList({ jobs }: { jobs: Job[] }) {
	return (
		<ol className="flex flex-col divide-y">
			{jobs.map((job) => (
				<li key={job.engine} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 gap-y-1 py-2 text-sm">
					<StatusIcon status={job.status} />
					<span className={job.status === 'waiting' ? 'text-muted-foreground' : 'font-medium'}>{job.engine}</span>
					<span className={job.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{jobStatusText(job)}</span>
					{(job.notes.length > 0 || job.reason) && (
						<p className="text-muted-foreground col-span-2 col-start-2 text-xs">{[...job.notes, job.reason].filter(Boolean).join(' ')}</p>
					)}
				</li>
			))}
		</ol>
	);
}
