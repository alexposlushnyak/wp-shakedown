import { useEffect, useState } from 'react';
import { ChevronsUpDownIcon, FolderIcon, FolderOpenIcon, PlayIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, q } from '@/lib/api';
import type { Detected, Dirs, EngineInfo, ProfileInfo } from '@/lib/api';
import { crumbs, detectedText, profilesFor } from '@/lib/run';

interface Props {
	engines: EngineInfo[];
	profiles: ProfileInfo[];
	startDir: string;
	running: boolean;
	onRun: (path: string, engines: string[] | undefined, profile: string | undefined) => void;
	onError: (message: string) => void;
}

export function TargetCard({ engines, profiles, startDir, running, onRun, onError }: Props) {
	const [path, setPath] = useState(startDir);
	const [detected, setDetected] = useState<{ text: string; known: boolean; kind?: string }>({ text: '', known: false });
	const [browsing, setBrowsing] = useState(false);
	const [dirs, setDirs] = useState<Dirs | null>(null);
	const [profile, setProfile] = useState('all');
	const [chosen, setChosen] = useState<string[]>(() => engines.map((e) => e.id));

	useEffect(() => {
		const value = path.trim();
		if (!value) {
			setDetected({ text: '', known: false });
			return;
		}
		const timer = setTimeout(() => {
			api<Detected>(`/api/detect?path=${q(value)}`).then(
				(d) => setDetected({ text: detectedText(d), known: true, kind: d.kind }),
				(err: Error) => setDetected({ text: err.message, known: false }),
			);
		}, 200);
		return () => clearTimeout(timer);
	}, [path]);

	const fitting = profilesFor(profiles, detected.kind);
	const picked = fitting.find((p) => p.id === profile);

	// A choice that does not fit the new kind of folder goes back to all checks.
	useEffect(() => {
		if (profile !== 'all' && !picked) setProfile('all');
	}, [profile, picked]);

	useEffect(() => {
		if (!browsing) return;
		api<Dirs>(`/api/dirs?path=${q(path.trim() || '/')}`).then(setDirs, (err: Error) => onError(err.message));
		// The list follows the folder that was opened, not every keystroke in the field.
	}, [browsing]);

	function open(folder: string) {
		setPath(folder);
		api<Dirs>(`/api/dirs?path=${q(folder)}`).then(setDirs, (err: Error) => onError(err.message));
	}

	function submit(event: React.FormEvent) {
		event.preventDefault();
		const value = path.trim();
		if (!value) return onError('Give a folder to test.');
		if (!picked && chosen.length === 0) return onError('Choose at least one engine.');
		setBrowsing(false);
		if (picked) return onRun(value, undefined, picked.id);
		onRun(value, chosen.length < engines.length ? chosen : undefined, undefined);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>What do you want to test?</CardTitle>
				<CardDescription>The folder of a theme, a plugin or a whole WordPress site.</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={submit} className="flex flex-col gap-4">
					<Field>
						<FieldLabel htmlFor="path">Folder</FieldLabel>
						<div className="flex flex-col gap-2 sm:flex-row">
							<Input
								id="path"
								value={path}
								onChange={(e) => setPath(e.target.value)}
								className="font-mono"
								autoComplete="off"
								spellCheck={false}
								autoCapitalize="off"
							/>
							<Button type="button" variant="outline" aria-expanded={browsing} onClick={() => setBrowsing(!browsing)}>
								{browsing ? <FolderOpenIcon /> : <FolderIcon />}
								{browsing ? 'Close' : 'Browse'}
							</Button>
							<Button type="submit" disabled={running}>
								<PlayIcon />
								Run the checks
							</Button>
						</div>
						<FieldDescription aria-live="polite">
							{detected.known ? <Badge variant="secondary">{detected.text}</Badge> : detected.text}
						</FieldDescription>
					</Field>

					{browsing && dirs && (
						<div className="rounded-lg border">
							<Breadcrumb className="border-b px-3 py-2">
								<BreadcrumbList>
									{crumbs(dirs.path).map((c, i) => (
										<span key={c.path} className="contents">
											{i > 1 && <BreadcrumbSeparator />}
											<BreadcrumbItem>
												<BreadcrumbLink asChild>
													<button type="button" className="font-mono" onClick={() => open(c.path)}>
														{c.name}
													</button>
												</BreadcrumbLink>
											</BreadcrumbItem>
										</span>
									))}
								</BreadcrumbList>
							</Breadcrumb>
							<ScrollArea className="h-56">
								{dirs.dirs.length === 0 ? (
									<p className="text-muted-foreground p-3 text-sm">This folder has no folders inside.</p>
								) : (
									<ul className="grid gap-0.5 p-2 sm:grid-cols-2 lg:grid-cols-3">
										{dirs.dirs.map((d) => (
											<li key={d.path}>
												<Button type="button" variant="ghost" size="sm" className="w-full justify-start font-mono" title={d.path} onClick={() => open(d.path)}>
													<FolderIcon />
													<span className="truncate">{d.name}</span>
												</Button>
											</li>
										))}
									</ul>
								)}
							</ScrollArea>
						</div>
					)}

					{fitting.length > 0 && (
						<Field>
							<FieldLabel htmlFor="profile">Profile</FieldLabel>
							<Select value={picked ? profile : 'all'} onValueChange={setProfile}>
								<SelectTrigger id="profile" className="w-full sm:w-80">
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
							{picked && <FieldDescription>{picked.summary}</FieldDescription>}
						</Field>
					)}

					{!picked && (
						<Collapsible>
							<CollapsibleTrigger asChild>
								<Button type="button" variant="ghost" size="sm" className="-ml-2">
									<ChevronsUpDownIcon />
									{chosen.length === engines.length ? `Engines: all ${engines.length}` : `Engines: ${chosen.length} of ${engines.length}`}
								</Button>
							</CollapsibleTrigger>
							<CollapsibleContent>
								<div className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-3">
									{engines.map((e) => (
										<label key={e.id} className="flex items-center gap-2 text-sm">
											<Checkbox
												checked={chosen.includes(e.id)}
												onCheckedChange={(on) => setChosen(on ? [...chosen, e.id] : chosen.filter((id) => id !== e.id))}
											/>
											{e.title}
											<span className="text-muted-foreground font-mono text-xs">{e.id}</span>
										</label>
									))}
								</div>
							</CollapsibleContent>
						</Collapsible>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
