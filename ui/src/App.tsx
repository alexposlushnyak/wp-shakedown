import { useEffect, useMemo, useState } from 'react';
import { CircleAlertIcon } from 'lucide-react';
import { ResultsCard } from '@/components/results-card';
import { RunCard } from '@/components/run-card';
import { TargetCard } from '@/components/target-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Toaster } from '@/components/ui/sonner';
import { api, listen, token } from '@/lib/api';
import type { Report, ServerState } from '@/lib/api';
import { runModel } from '@/lib/run';
import type { WireEvent } from '@/lib/run';

export default function App() {
	const [info, setInfo] = useState<ServerState | null>(null);
	const [events, setEvents] = useState<WireEvent[]>([]);
	const [report, setReport] = useState<Report | null>(null);
	const [error, setError] = useState(token ? '' : 'Open the link that wp-shakedown printed in the terminal. It carries the access token.');

	const model = useMemo(() => runModel(events), [events]);

	useEffect(() => {
		if (!token) return;
		const loadReport = () => api<Report>('/api/report').then(setReport, () => setReport(null));
		api<ServerState>('/api/state').then(setInfo, (err: Error) => setError(err.message));
		return listen(
			(all, running) => {
				setEvents(all);
				if (!running && all.some((e) => e.type === 'run:end')) loadReport();
			},
			(event) => {
				setEvents((prev) => (event.type === 'run:start' ? [event] : [...prev, event]));
				if (event.type === 'run:end') loadReport();
			},
		);
	}, []);

	function run(path: string, engines: string[] | undefined) {
		setError('');
		setReport(null);
		api('/api/run', { path, ...(engines ? { engines } : {}) }).catch((err: Error) => setError(err.message));
	}

	const message = error || model.error;

	return (
		<div className="mx-auto flex min-h-svh max-w-5xl flex-col gap-6 p-4 sm:p-6">
			<header className="flex items-center justify-between">
				<span className="text-lg font-semibold tracking-tight">wp-shakedown</span>
				{info && <Badge variant="outline">{info.version}</Badge>}
			</header>

			{message && (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>That did not work</AlertTitle>
					<AlertDescription>{message}</AlertDescription>
				</Alert>
			)}

			{info && <TargetCard engines={info.engines} startDir={info.startDir} running={model.running} onRun={run} onError={setError} />}
			{model.started && <RunCard model={model} onStop={() => api('/api/cancel', {}).catch((err: Error) => setError(err.message))} />}
			{report && !model.running && <ResultsCard report={report} />}

			<Toaster />
		</div>
	);
}
