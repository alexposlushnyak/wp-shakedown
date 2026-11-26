import { EllipsisIcon, FileArchiveIcon, FolderPlusIcon, FolderTreeIcon } from 'lucide-react';
import { Mark } from '@/components/mark';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface Props {
	status: string;
	busy: boolean;
	/** Whether the server can open the folder dialog of the system. Without it, adding goes to the path field. */
	picker: boolean;
	onPick: () => void;
	onUpload: () => void;
	onBrowse: () => void;
}

/** The dock at the bottom of every screen: home, what runs now, and the ways to add a project. */
export function AppDock({ status, busy, picker, onPick, onUpload, onBrowse }: Props) {
	return (
		<nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
			<div className="bg-panel/85 pointer-events-auto flex h-14 items-center gap-1 rounded-2xl border p-2 shadow-[0_16px_48px_-16px_rgb(0_0_0/0.9)] backdrop-blur-xl">
				<Tooltip>
					<TooltipTrigger asChild>
						<a href="#/" aria-label="Projects" className="focus-visible:ring-ring/50 block size-10 rounded-xl outline-none focus-visible:ring-3">
							<Mark className="size-full" />
						</a>
					</TooltipTrigger>
					<TooltipContent side="top">Projects</TooltipContent>
				</Tooltip>
				<Separator orientation="vertical" className="mx-1 !h-6" />
				<span role="status" aria-live="polite" className="text-muted-foreground flex items-center gap-2 px-2 text-sm whitespace-nowrap tabular-nums">
					<span className={cn('size-1.5 rounded-full', busy ? 'bg-foreground animate-pulse' : 'bg-muted-foreground/40')} aria-hidden="true" />
					{status}
				</span>
				<Separator orientation="vertical" className="mx-1 !h-6" />
				<Button className="h-10 rounded-xl px-3.5" onClick={picker ? onPick : onBrowse}>
					<FolderPlusIcon />
					Add a folder
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" className="size-10 rounded-xl" aria-label="More ways to add">
							<EllipsisIcon />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent side="top" align="end" sideOffset={10} className="min-w-56">
						<DropdownMenuItem onSelect={onUpload}>
							<FileArchiveIcon />
							Upload ZIP files
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={onBrowse}>
							<FolderTreeIcon />
							Browse or type a path
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</nav>
	);
}
