'use client'

// The product's in-flight cue: three dots rising in sequence beside a text label.
// Replaces the bare spinner that used to sit next to "is answering…" — a spinner
// stops being informative the moment the first token arrives, while these stay
// alive for the whole turn and are reused for both hops (Jev deciding, then the
// model answering). The animation is pure CSS (`.stream-dot` in globals.css), so
// prefers-reduced-motion settles it without JS.
//
// Shared since milestone 5: the chat transcript, the AgentOS run view (a run
// starting, the replay list refreshing) and any other in-flight label all use
// this one component rather than each surface inventing its own loader.
//
// The dots are aria-hidden: the `label` carries the meaning, and this renders
// inside a region whose state is already announced by a `role="status"` live
// region.
export function StreamDots({ label, className }: { label: string; className?: string }) {
	return (
		<span className={className}>
			<span aria-hidden className="text-text-faint mr-2 inline-flex items-center gap-1">
				{[0, 1, 2].map((i) => (
					<span
						key={i}
						style={{ '--i': i } as React.CSSProperties}
						className="stream-dot bg-text-faint inline-block size-1.5 rounded-full"
					/>
				))}
			</span>
			{label}
		</span>
	)
}
