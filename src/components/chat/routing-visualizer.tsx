'use client'
import { MODELS, MODEL_LABELS } from '@/lib/models'
import type { RouteEventPayload } from '@/lib/chat-stream'
import { cn } from '@/lib/cn'
import { StreamDots } from '@/components/ui/stream-dots'
import { AlertIcon } from '@/components/ui/icons'

// The routing visualizer: the visual proof of what Jev decided and how fast.
// Shows the chosen model, Jev's per-label probability distribution as bars, its
// calibrated confidence, and the measured Jev latency (the honest number — never
// the brief's un-reproduced "~30-50ms"). When Jev was unreachable and we fell
// back to the default, it says so plainly instead of pretending.

function ModelDot({ color, className }: { color: string; className?: string }) {
	return (
		<span
			className={cn('inline-block size-2 shrink-0 rounded-full', className)}
			style={{ backgroundColor: color }}
			aria-hidden
		/>
	)
}

export function RoutingVisualizer({ route }: { route: RouteEventPayload }) {
	const chosen = MODELS[route.label]

	return (
		<div className="border-border bg-surface mt-2 animate-[fade-rise_var(--motion-base)_var(--ease-out-soft)_both] rounded-lg border p-3 motion-reduce:animate-none">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<ModelDot
						color={chosen.color}
						className="animate-[route-pulse_var(--motion-slow)_var(--ease-spring)_both] motion-reduce:animate-none"
					/>
					<span className="text-text text-sm font-medium">Routed to {chosen.displayName}</span>
				</div>
				<span className="text-text-faint font-numeric text-xs">
					Jev decided in {route.jevLatencyMs}ms
				</span>
			</div>

			{route.fallback ? (
				<div className="text-warning mt-2 flex items-start gap-1.5 text-xs">
					<AlertIcon size={14} className="mt-0.5 shrink-0" />
					<span>
						Jev was unavailable ({route.fallbackReason || 'unknown reason'}). Fell back to the
						default model. Routing degraded for this turn; the answer still streamed.
					</span>
				</div>
			) : (
				<>
					<div className="mt-3 space-y-1.5">
						{MODEL_LABELS.map((label, index) => {
							const model = MODELS[label]
							const probability = route.probabilities[label] ?? 0
							const isChosen = label === route.label
							return (
								<div key={label} className="flex items-center gap-2">
									<span
										className={cn(
											'w-16 shrink-0 text-xs',
											isChosen ? 'text-text font-medium' : 'text-text-faint'
										)}
									>
										{model.shortName}
									</span>
									<span className="bg-surface-hover relative h-2 flex-1 overflow-hidden rounded-full">
										<span
											className={cn(
												'route-trace absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 motion-reduce:transition-none',
												!isChosen && 'opacity-40'
											)}
											style={
												{
													width: `${Math.round(probability * 100)}%`,
													backgroundColor: model.color,
													'--i': index
												} as React.CSSProperties
											}
										/>
									</span>
									<span className="text-text-faint font-numeric w-9 shrink-0 text-right text-xs">
										{Math.round(probability * 100)}%
									</span>
								</div>
							)
						})}
					</div>
					<div className="text-text-faint mt-2 text-xs">
						Jev confidence:{' '}
						<span className="text-text-muted font-numeric">
							{Math.round(route.confidence * 100)}%
						</span>
					</div>
				</>
			)}
		</div>
	)
}

// Shown on the assistant bubble while Jev is still deciding (before the `route`
// event arrives) — the brief's "prove the speed" story starts here.
export function RoutingPending() {
	return (
		<StreamDots
			className="text-text-muted flex items-center gap-2 text-sm"
			label="Jev is routing"
		/>
	)
}
