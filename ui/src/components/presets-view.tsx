import { useState } from 'react';
import { ArrowLeftIcon, CopyIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { LevelControl } from '@/components/level-control';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { EngineInfo, FailOn, PresetInfo, Provider } from '@/lib/api';
import { DEFAULT_LEVEL, assistantNote, freeId, levelLabel, plural, presetId } from '@/lib/run';

const DIRECTORIES = [
	['none', 'None'],
	['wporg', 'WordPress.org'],
	['envato', 'ThemeForest'],
] as const;

const ASSISTANTS = [
	['none', 'None'],
	['claude', 'Claude Code'],
	['codex', 'Codex'],
	['api', 'Anthropic API key'],
] as const;

const KINDS = [
	['theme', 'Themes'],
	['plugin', 'Plugins'],
	['install', 'WordPress folders'],
] as const;

const FAIL_ON: [FailOn, string][] = [
	['error', 'Critical'],
	['warning', 'Important'],
	['info', 'Recommended'],
	['never', 'Never'],
];

const KIND_TEXT: Record<string, string> = { theme: 'themes', plugin: 'plugins', install: 'WordPress folders' };

function kindsText(kinds: string[]): string {
	return KINDS.filter(([k]) => kinds.includes(k)).map(([k]) => KIND_TEXT[k]).join(', ');
}

function List({ presets }: { presets: PresetInfo[] }) {
	const groups = [
		['Built in', presets.filter((p) => p.builtIn)],
		['Yours', presets.filter((p) => !p.builtIn)],
	] as const;
	return (
		<section className="flex flex-col gap-10">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<h1 className="text-3xl font-semibold tracking-[-0.02em]">Presets</h1>
				<Button asChild>
					<a href="#/presets/new">
						<PlusIcon />
						New preset
					</a>
				</Button>
			</div>
			{groups.map(([title, list]) => (
				<section key={title} className="flex flex-col gap-1">
					<h2 className="text-muted-foreground flex items-baseline gap-2 text-sm font-medium">
						{title}
						<span className="text-muted-foreground/60 tabular-nums">{list.length}</span>
					</h2>
					{list.length === 0 ? (
						<p className="text-muted-foreground py-3 text-sm">None yet. Copy a built-in preset or start a new one.</p>
					) : (
						<ItemGroup className="gap-0">
							{list.map((p) => (
								<Item key={p.id} asChild className="hover:bg-accent/60 -mx-3 rounded-xl px-3 py-3 transition-colors duration-100">
									<a href={`#/presets/${encodeURIComponent(p.id)}`}>
										<ItemContent className="min-w-0">
											<ItemTitle className="text-[15px]">{p.title}</ItemTitle>
											<ItemDescription className="truncate">
												{kindsText(p.kinds)}, {plural(p.engines.length, 'engine', 'engines')}
											</ItemDescription>
										</ItemContent>
										<ItemActions>
											<span className="text-muted-foreground text-sm tabular-nums">{levelLabel(p.level ?? DEFAULT_LEVEL)}</span>
										</ItemActions>
									</a>
								</Item>
							))}
						</ItemGroup>
					)}
				</section>
			))}
		</section>
	);
}

interface EditorProps {
	start: PresetInfo;
	isNew: boolean;
	/** IDs already in use. A new preset cannot take one, or saving would replace that preset. */
	taken: string[];
	engines: EngineInfo[];
	onSave: (preset: PresetInfo) => Promise<void>;
	onRemove: (id: string) => Promise<void>;
}

function Editor({ start, isNew, taken, engines, onSave, onRemove }: EditorProps) {
	// The view gives each preset its own key, so a new address starts a fresh draft.
	const [draft, setDraft] = useState<PresetInfo>(start);
	const [idTouched, setIdTouched] = useState(!isNew);

	const readOnly = draft.builtIn === true;
	const set = (patch: Partial<PresetInfo>) => setDraft((d) => ({ ...d, ...patch }));
	const fitting = engines.filter((e) => e.kinds.some((k) => draft.kinds.includes(k)));
	const clash = isNew && taken.includes(draft.id);
	const valid = !clash && draft.id !== '' && draft.title.trim() !== '' && draft.summary.trim() !== '' && draft.kinds.length > 0 && draft.engines.length > 0;

	function toggle<T>(list: T[], value: T, on: boolean): T[] {
		return on ? [...new Set([...list, value])] : list.filter((x) => x !== value);
	}

	return (
		<section className="flex flex-col gap-8">
			<Button variant="ghost" size="sm" className="text-muted-foreground -ml-2 self-start" asChild>
				<a href="#/presets">
					<ArrowLeftIcon />
					Presets
				</a>
			</Button>
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="text-3xl font-semibold tracking-[-0.02em]">{isNew ? 'New preset' : draft.title}</h1>
					<p className="text-muted-foreground flex items-center gap-2 text-sm">
						<span className="font-mono">{draft.id || 'preset-id'}</span>
						{readOnly && <Badge variant="outline">Built in</Badge>}
					</p>
				</div>
				{readOnly && (
					<Button asChild variant="outline">
						<a href={`#/presets/new?from=${encodeURIComponent(draft.id)}`}>
							<CopyIcon />
							Copy to a new preset
						</a>
					</Button>
				)}
			</div>

			<div className="grid gap-6 sm:grid-cols-2">
				<div className="flex flex-col gap-2">
					<Label htmlFor="preset-title">Title</Label>
					<Input
						id="preset-title"
						value={draft.title}
						disabled={readOnly}
						onChange={(e) => set({ title: e.target.value, ...(idTouched ? {} : { id: presetId(e.target.value) }) })}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="preset-id">ID</Label>
					<Input
						id="preset-id"
						className="font-mono"
						value={draft.id}
						disabled={readOnly || !isNew}
						onChange={(e) => {
							setIdTouched(true);
							set({ id: presetId(e.target.value) });
						}}
						aria-invalid={clash}
					/>
					{clash && <p className="text-destructive text-sm">A preset with this ID exists. Pick another ID.</p>}
				</div>
				<div className="flex flex-col gap-2 sm:col-span-2">
					<Label htmlFor="preset-summary">What it is for</Label>
					<Input id="preset-summary" value={draft.summary} disabled={readOnly} onChange={(e) => set({ summary: e.target.value })} />
				</div>
			</div>

			<div className="flex flex-col gap-3">
				<p className="text-sm font-medium">Fits</p>
				<div className="flex flex-wrap gap-6">
					{KINDS.map(([kind, label]) => (
						<Label key={kind} className="font-normal">
							<Checkbox checked={draft.kinds.includes(kind)} disabled={readOnly} onCheckedChange={(on) => set({ kinds: toggle(draft.kinds, kind, on === true) })} />
							{label}
						</Label>
					))}
				</div>
			</div>

			<div className="grid gap-6 sm:grid-cols-2">
				<div className="flex flex-col gap-3">
					<p className="text-sm font-medium">Level</p>
					<LevelControl value={draft.level ?? DEFAULT_LEVEL} onChange={(level) => set({ level })} disabled={readOnly} className="flex items-center gap-3" />
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="preset-directory">Directory rules</Label>
					<Select
						value={draft.directory ?? 'none'}
						disabled={readOnly}
						onValueChange={(v) => {
							const { directory: _drop, ...rest } = draft;
							setDraft(v === 'none' ? rest : { ...rest, directory: v as 'wporg' | 'envato' });
						}}
					>
						<SelectTrigger id="preset-directory" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{DIRECTORIES.map(([value, label]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="preset-fail">The command fails at</Label>
					<Select value={draft.failOn ?? 'error'} disabled={readOnly} onValueChange={(v) => set({ failOn: v as FailOn })}>
						<SelectTrigger id="preset-fail" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{FAIL_ON.map(([value, label]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<Label htmlFor="preset-assistant">Assistant</Label>
				<Select
					value={draft.assistant ?? 'none'}
					disabled={readOnly}
					onValueChange={(v) => {
						const { assistant: _drop, ...rest } = draft;
						setDraft(v === 'none' ? rest : { ...rest, assistant: v as Provider });
					}}
				>
					<SelectTrigger id="preset-assistant" className="w-full sm:w-1/2">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{ASSISTANTS.map(([value, label]) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-muted-foreground text-sm">{assistantNote(draft.assistant)}</p>
			</div>

			<div className="flex flex-col gap-1">
				<p className="text-sm font-medium">Engines</p>
				<p className="text-muted-foreground text-sm">An engine runs when it is on here and the level of the run reaches its own.</p>
				<ul className="mt-2">
					{fitting.map((e) => (
						<li key={e.id}>
							<Label className="hover:bg-accent/60 -mx-3 flex items-center gap-3 rounded-xl px-3 py-2.5 font-normal transition-colors duration-100">
								<span className="min-w-0 flex-1">
									<span className="block text-[15px] font-medium">{e.id}</span>
									<span className="text-muted-foreground block text-sm">{e.title}</span>
								</span>
								<span className="text-muted-foreground text-sm tabular-nums">Level {e.level}</span>
								<Switch checked={draft.engines.includes(e.id)} disabled={readOnly} onCheckedChange={(on) => set({ engines: toggle(draft.engines, e.id, on) })} />
							</Label>
						</li>
					))}
				</ul>
			</div>

			{!readOnly && (
				<div className="flex flex-wrap items-center gap-2">
					<Button disabled={!valid} onClick={() => void onSave(draft)}>
						Save the preset
					</Button>
					{!isNew && (
						<Button variant="ghost" className="text-muted-foreground" onClick={() => void onRemove(draft.id)}>
							<Trash2Icon />
							Delete
						</Button>
					)}
				</div>
			)}
		</section>
	);
}

interface Props {
	/** The preset in the address, "new", or undefined for the list. */
	id?: string;
	presets: PresetInfo[];
	engines: EngineInfo[];
	onSave: (preset: PresetInfo) => Promise<void>;
	onRemove: (id: string) => Promise<void>;
}

export function PresetsView({ id, presets, engines, onSave, onRemove }: Props) {
	if (id === undefined) return <List presets={presets} />;
	if (id.startsWith('new')) {
		const from = new URLSearchParams(id.split('?')[1] ?? '').get('from');
		const base = presets.find((p) => p.id === from);
		const start: PresetInfo = base
			? { ...base, id: freeId(`${base.id}-copy`, presets.map((p) => p.id)), title: `${base.title} copy`, builtIn: false }
			: { id: '', title: '', summary: '', kinds: ['theme', 'plugin'], engines: [], level: DEFAULT_LEVEL, failOn: 'error' };
		return <Editor key={id} start={start} isNew taken={presets.map((p) => p.id)} engines={engines} onSave={onSave} onRemove={onRemove} />;
	}
	const found = presets.find((p) => p.id === id);
	if (!found) return <p className="text-muted-foreground">No preset "{id}".</p>;
	return <Editor key={id} start={found} isNew={false} taken={[]} engines={engines} onSave={onSave} onRemove={onRemove} />;
}
