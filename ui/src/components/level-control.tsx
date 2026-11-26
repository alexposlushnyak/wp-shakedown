import { Slider } from '@/components/ui/slider';
import { levelLabel } from '@/lib/run';

/** How thorough the next runs are, from 0 (does the PHP parse) to 10 (every check the tool has). */
export function LevelControl({ value, onChange, className, disabled }: { value: number; onChange: (level: number) => void; className?: string; disabled?: boolean }) {
	return (
		<div className={className ?? 'flex w-56 items-center gap-3'}>
			<Slider min={0} max={10} step={1} disabled={disabled} value={[value]} onValueChange={(v) => onChange(v[0] ?? value)} aria-label="Level" className="flex-1" />
			<span className="text-muted-foreground w-32 shrink-0 text-sm tabular-nums">{levelLabel(value)}</span>
		</div>
	);
}
