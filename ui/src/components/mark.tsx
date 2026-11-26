import { useId } from 'react';

// The mark of wpshakedown.dev: a heavy lowercase w and the blue square, on a light tile.
export function Mark({ className }: { className?: string }) {
	const id = useId();
	return (
		<svg viewBox="0 0 32 32" className={className} aria-hidden="true">
			<rect width="32" height="32" rx="7.5" fill="var(--foreground)" />
			<clipPath id={id}>
				<rect x="0" y="9" width="32" height="14" />
			</clipPath>
			<polyline clipPath={`url(#${id})`} points="4.6,7 9,24.6 13.4,10.6 17.8,24.6 22.2,7" fill="none" stroke="var(--background)" strokeWidth="3.6" strokeMiterlimit="10" />
			<rect x="23.2" y="19.6" width="3.4" height="3.4" fill="var(--brand)" />
		</svg>
	);
}
