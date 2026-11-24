import { useEffect, useState } from 'react';
import { FolderIcon } from 'lucide-react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api, q } from '@/lib/api';
import type { Detected, Dirs } from '@/lib/api';
import { crumbs, detectedText } from '@/lib/run';

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	startDir: string;
	onAdd: (path: string) => Promise<void>;
	onError: (message: string) => void;
}

export function AddDialog({ open, onOpenChange, startDir, onAdd, onError }: Props) {
	const [path, setPath] = useState(startDir);
	const [detected, setDetected] = useState<{ text: string; known: boolean }>({ text: '', known: false });
	const [dirs, setDirs] = useState<Dirs | null>(null);

	useEffect(() => {
		const value = path.trim();
		if (!open || !value) {
			setDetected({ text: '', known: false });
			return;
		}
		const timer = setTimeout(() => {
			api<Detected>(`/api/detect?path=${q(value)}`).then(
				(d) => setDetected({ text: detectedText(d), known: true }),
				(err: Error) => setDetected({ text: err.message, known: false }),
			);
		}, 200);
		return () => clearTimeout(timer);
	}, [path, open]);

	useEffect(() => {
		if (!open) return;
		api<Dirs>(`/api/dirs?path=${q(path.trim() || '/')}`).then(setDirs, (err: Error) => onError(err.message));
		// The list follows the folder that was opened, not every keystroke in the field.
	}, [open]);

	function browse(folder: string) {
		setPath(folder);
		api<Dirs>(`/api/dirs?path=${q(folder)}`).then(setDirs, (err: Error) => onError(err.message));
	}

	function submit(event: React.FormEvent) {
		event.preventDefault();
		if (detected.known) onAdd(path.trim()).then(() => onOpenChange(false), () => {});
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<form onSubmit={submit} className="flex flex-col gap-4">
					<DialogHeader>
						<DialogTitle>Add a folder</DialogTitle>
						<DialogDescription>The folder of a theme, a plugin or a whole WordPress site.</DialogDescription>
					</DialogHeader>
					<Input
						aria-label="Folder"
						value={path}
						onChange={(e) => setPath(e.target.value)}
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						autoCapitalize="off"
					/>
					<p className={detected.known ? 'text-sm' : 'text-muted-foreground text-sm'} aria-live="polite">
						{detected.text}
					</p>
					{dirs && (
						<div className="rounded-lg border">
							<Breadcrumb className="border-b px-3 py-2">
								<BreadcrumbList>
									{crumbs(dirs.path).map((c, i) => (
										<span key={c.path} className="contents">
											{i > 1 && <BreadcrumbSeparator />}
											<BreadcrumbItem>
												<BreadcrumbLink asChild>
													<button type="button" className="font-mono" onClick={() => browse(c.path)}>
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
									<ul className="grid gap-0.5 p-2 sm:grid-cols-2">
										{dirs.dirs.map((d) => (
											<li key={d.path}>
												<Button type="button" variant="ghost" size="sm" className="w-full justify-start font-mono" title={d.path} onClick={() => browse(d.path)}>
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
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={!detected.known}>
							Add
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
