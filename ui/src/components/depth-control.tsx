import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Depth } from '@/lib/api';

export function DepthControl({ value, onChange }: { value: Depth; onChange: (depth: Depth) => void }) {
	return (
		<ToggleGroup
			type="single"
			size="sm"
			variant="outline"
			value={value}
			aria-label="Depth"
			onValueChange={(v) => {
				if (v) onChange(v as Depth);
			}}
		>
			<ToggleGroupItem value="quick">Quick</ToggleGroupItem>
			<ToggleGroupItem value="standard">Standard</ToggleGroupItem>
			<ToggleGroupItem value="deep">Deep</ToggleGroupItem>
		</ToggleGroup>
	);
}
