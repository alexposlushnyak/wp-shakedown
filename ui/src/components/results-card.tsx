import { useMemo, useState } from 'react';
import { ClipboardIcon, SearchIcon, SparklesIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Report } from '@/lib/api';
import { aiPrompt, distinct, filterFindings, groupByFile, plural, severityCounts, styleCounts } from '@/lib/run';
import type { Filter, Finding, Severity } from '@/lib/run';

const ALL = 'all';

async function copy(text: string, done: string) {
	try {
		await navigator.clipboard.writeText(text);
		toast.success(done);
	} catch {
		toast.error('The browser did not allow copying.');
	}
}

function SeverityBadge({ severity }: { severity: Severity }) {
	if (severity === 'error') return <Badge variant="destructive">error</Badge>;
	if (severity === 'warning') return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">warning</Badge>;
	return <Badge variant="secondary">note</Badge>;
}

function FindingRow({ finding }: { finding: Finding }) {
	return (
		<TableRow>
			<TableCell className="w-24 align-top">
				<SeverityBadge severity={finding.severity} />
			</TableCell>
			<TableCell className="text-muted-foreground w-20 align-top tabular-nums">{finding.location.line ? `line ${finding.location.line}` : ''}</TableCell>
			<TableCell className="align-top whitespace-normal">
				<p className="break-words">{finding.message}</p>
				<p className="text-muted-foreground mt-1 font-mono text-xs break-all">
					{finding.engine}: {finding.rule}
				</p>
				{finding.hint && <p className="text-muted-foreground mt-1 text-xs">Fix: {finding.hint}</p>}
				{finding.docs && /^https?:\/\//.test(finding.docs) && (
					<a className="mt-1 block text-xs underline underline-offset-4" href={finding.docs} target="_blank" rel="noreferrer">
						{finding.docs}
					</a>
				)}
			</TableCell>
			<TableCell className="w-28 text-right align-top">
				<Button variant="ghost" size="sm" className="text-muted-foreground font-mono text-xs" title="Copy this ID" onClick={() => copy(finding.id, 'ID copied.')}>
					{finding.id}
				</Button>
			</TableCell>
		</TableRow>
	);
}

export function ResultsCard({ report }: { report: Report }) {
	const { result, diff, files } = report;
	const [filter, setFilter] = useState<Filter>({ severity: '', engine: '', category: '', text: '', style: false });
	const reportFile = files[0] ?? '';

	const counts = useMemo(() => severityCounts(result.findings, filter.style ?? false), [result.findings, filter.style]);
	const shown = useMemo(() => filterFindings(result.findings, filter), [result.findings, filter]);
	const groups = useMemo(() => groupByFile(shown), [shown]);
	const style = useMemo(() => styleCounts(result.findings), [result.findings]);
	const styleTotal = style.reduce((n, r) => n + r.count, 0);
	const suppressed = result.findings.filter((f) => f.suppressed);
	const active = result.findings.filter((f) => !f.suppressed).length;
	const s = result.summary;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Results</CardTitle>
				<CardDescription className="flex flex-wrap items-center gap-2">
					<Badge variant={s.error ? 'destructive' : 'outline'}>{plural(s.error, 'error', 'errors')}</Badge>
					<Badge variant={s.warning ? 'secondary' : 'outline'}>{plural(s.warning, 'warning', 'warnings')}</Badge>
					<Badge variant="outline">{plural(s.info, 'note', 'notes')}</Badge>
					{s.suppressed > 0 && <Badge variant="outline">{s.suppressed} suppressed</Badge>}
					{diff && (
						<span>
							Since the last run: {diff.fixed.length} fixed, {diff.added.length} new, {diff.open.length} still open.
						</span>
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				<div className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
					<span className="text-muted-foreground">Report file</span>
					<code className="font-mono text-xs break-all">{reportFile}</code>
					<span className="ml-auto flex flex-wrap gap-2">
						<Button variant="outline" size="sm" onClick={() => copy(reportFile, 'Path copied.')}>
							<ClipboardIcon />
							Copy path
						</Button>
						<Button variant="outline" size="sm" onClick={() => copy(aiPrompt(reportFile), 'Prompt copied.')}>
							<SparklesIcon />
							Copy a prompt for your AI assistant
						</Button>
					</span>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<Tabs value={filter.severity || ALL} onValueChange={(v) => setFilter({ ...filter, severity: v === ALL ? '' : (v as Severity) })}>
						<TabsList>
							<TabsTrigger value={ALL}>All {counts.error + counts.warning + counts.info}</TabsTrigger>
							<TabsTrigger value="error">Errors {counts.error}</TabsTrigger>
							<TabsTrigger value="warning">Warnings {counts.warning}</TabsTrigger>
							<TabsTrigger value="info">Notes {counts.info}</TabsTrigger>
						</TabsList>
					</Tabs>
					<Select value={filter.engine || ALL} onValueChange={(v) => setFilter({ ...filter, engine: v === ALL ? '' : v })}>
						<SelectTrigger className="w-40" aria-label="Engine">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>All engines</SelectItem>
							{distinct(result.findings, 'engine').map((e) => (
								<SelectItem key={e} value={e}>
									{e}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select value={filter.category || ALL} onValueChange={(v) => setFilter({ ...filter, category: v === ALL ? '' : v })}>
						<SelectTrigger className="w-44" aria-label="Category">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>All categories</SelectItem>
							{distinct(result.findings, 'category').map((c) => (
								<SelectItem key={c} value={c}>
									{c}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div className="relative min-w-48 flex-1">
						<SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
						<Input
							type="search"
							aria-label="Search the findings"
							placeholder="Search message, rule or file"
							className="pl-8"
							value={filter.text}
							onChange={(e) => setFilter({ ...filter, text: e.target.value })}
						/>
					</div>
					<label className="flex items-center gap-2 text-sm">
						<Checkbox checked={filter.style} onCheckedChange={(on) => setFilter({ ...filter, style: on === true })} />
						List code style findings
					</label>
				</div>

				{groups.length === 0 ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<SearchIcon />
							</EmptyMedia>
							<EmptyTitle>{active === 0 ? 'No findings' : 'Nothing matches'}</EmptyTitle>
							<EmptyDescription>{active === 0 ? 'The engines found nothing in this target.' : 'No finding matches these filters.'}</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					groups.map((group) => (
						<section key={group.file} className="overflow-hidden rounded-lg border">
							<h3 className="bg-muted/50 border-b px-3 py-2 font-mono text-sm font-medium break-all">{group.file}</h3>
							<Table>
								<TableBody>
									{group.items.map((f) => (
										<FindingRow key={f.id} finding={f} />
									))}
								</TableBody>
							</Table>
						</section>
					))
				)}

				{style.length > 0 && (
					<section className="flex flex-col gap-2">
						<h3 className="font-medium">Code style</h3>
						<p className="text-muted-foreground text-sm">
							{plural(styleTotal, 'style finding', 'style findings')} in {plural(style.length, 'rule', 'rules')}. Tick "List code style findings" to see each
							one.
						</p>
						<div className="overflow-hidden rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Rule</TableHead>
										<TableHead className="text-right">Findings</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{style.map((r) => (
										<TableRow key={r.rule}>
											<TableCell className="font-mono text-xs whitespace-normal break-all">{r.rule}</TableCell>
											<TableCell className="text-right tabular-nums">{r.count}</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</section>
				)}

				{suppressed.length > 0 && (
					<section className="flex flex-col gap-2">
						<h3 className="font-medium">Suppressed</h3>
						<ul className="text-sm">
							{suppressed.map((f) => (
								<li key={f.id} className="border-b py-2">
									<code className="font-mono text-xs">{f.id}</code> {f.engine}: {f.rule}. Reason: {f.suppressed?.reason}
								</li>
							))}
						</ul>
					</section>
				)}

				{result.staleBaseline.length > 0 && (
					<section className="flex flex-col gap-2">
						<h3 className="font-medium">Stale baseline entries</h3>
						<p className="text-muted-foreground text-sm">These baseline entries match nothing now. Remove them.</p>
						<ul className="font-mono text-xs">
							{result.staleBaseline.map((id) => (
								<li key={id} className="border-b py-2">
									{id}
								</li>
							))}
						</ul>
					</section>
				)}
			</CardContent>
		</Card>
	);
}
