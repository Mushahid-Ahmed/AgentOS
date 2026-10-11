'use client'
import type { ChatMessage } from './use-chat'
import { Markdown } from './markdown'
import { RoutingVisualizer, RoutingPending } from './routing-visualizer'
import { TelemetryChips } from './telemetry'
import { StreamDots } from '@/components/ui/stream-dots'
import { AlertIcon, UserIcon } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'

// One turn in the transcript. User turns are a plain right-aligned bubble.
// Assistant turns carry the whole Jev-Swarm story: the routing decision, the
// streamed Markdown answer, and the telemetry — plus honest pending / stopped /
// error states.

export function MessageBubble({
	message,
	onRetry
}: {
	message: ChatMessage
	onRetry?: () => void
}) {
	if (message.role === 'user') {
		return (
			<div
				className="bubble-in flex justify-end"
				style={{ '--bubble-from': '16px' } as React.CSSProperties}
			>
				<div className="bg-accent text-accent-ink max-w-[85%] rounded-lg rounded-br-sm px-3.5 py-2 text-sm whitespace-pre-wrap sm:max-w-[75%]">
					{message.content}
				</div>
			</div>
		)
	}

	const { route, telemetry, error, pending, stopped, content } = message
	// Routing is in flight until the `route` event lands.
	const routing = pending && !route
	// Answer is in flight once routed but before any token (or while streaming).
	const generating = pending && route && !content && !error

	return (
		<div
			className="bubble-in flex gap-2.5"
			style={{ '--bubble-from': '-12px' } as React.CSSProperties}
		>
			<span
				className="border-border bg-surface text-text-muted mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border"
				aria-hidden
			>
				<UserIcon size={15} />
			</span>
			<div className="min-w-0 max-w-[85%] flex-1 sm:max-w-[80%]">
				{routing ? <RoutingPending /> : null}

				{route ? <RoutingVisualizer route={route} /> : null}

				{generating ? (
					<StreamDots
						className="text-text-muted mt-2 block text-sm"
						label={`${route.displayName} is answering`}
					/>
				) : null}

				{content ? (
					<div className="mt-1">
						<Markdown content={content} />
					</div>
				) : null}

				{stopped ? (
					<p className="text-text-faint mt-2 text-xs italic">Stopped before completing.</p>
				) : null}

				{error ? (
					<div className="border-danger/40 bg-danger/10 text-danger mt-2 rounded-lg border p-3">
						<div className="flex items-start gap-2">
							<AlertIcon size={16} className="mt-0.5 shrink-0" />
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium">This turn failed</p>
								<p className="mt-0.5 text-xs break-words opacity-90">{error}</p>
								{onRetry ? (
									<Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
										Retry
									</Button>
								) : null}
							</div>
						</div>
					</div>
				) : null}

				{telemetry && !error ? <TelemetryChips telemetry={telemetry} /> : null}
			</div>
		</div>
	)
}
