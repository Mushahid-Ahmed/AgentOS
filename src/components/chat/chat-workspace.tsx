'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useChat } from './use-chat'
import { MessageBubble } from './message-bubble'
import { ChatInput } from './chat-input'
import { CONVERSATIONS_QUERY_KEY, ConversationSidebar } from './conversation-sidebar'
import { AppHeader } from '@/components/nav/app-header'
import { AlertIcon, MenuIcon } from '@/components/ui/icons'
import { SkeletonLines } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'

// The chat workspace view. Composes the history sidebar, the transcript, the
// composer, and the top-level error banner. The executive dashboard is a
// separate view built in a later milestone.

const EXAMPLES = [
	'Explain the difference between a stack and a queue, with a code example.',
	'Write a haiku about routing decisions.',
	'What is the capital of France?'
]

function EmptyState({ onPick }: { onPick: (value: string) => void }) {
	return (
		<div className="panel-in relative mx-auto flex max-w-md flex-col items-center gap-4 overflow-hidden py-10 text-center">
			{/* The same aurora field the dashboard masthead and the auth doors use, at
			    product strength, so the first screen of the app is unmistakably the
			    landing's. `overflow-hidden` above is load-bearing: the lobes are inset
			    past the box and <main> scrolls on both axes. */}
			<div className="app-aurora" aria-hidden="true" />
			<div className="relative">
				<p className="label-uppercase text-text-faint">Jev · multi-model routing</p>
				<h2 className="hero-editorial text-text mt-2">Ask, and see who answers.</h2>
				<p className="text-text-muted mt-2 text-sm leading-relaxed">
					Send a message. Jev — a sub-second decision model — routes it to the best-fit among
					Claude, GPT and Gemini, then that model streams the answer. Every turn shows the routing
					decision and the real latency, token and cost telemetry.
				</p>
			</div>
			<div className="relative flex w-full flex-col gap-2">
				{EXAMPLES.map((example, index) => (
					<button
						key={example}
						type="button"
						onClick={() => onPick(example)}
						style={{ '--i': index + 1 } as React.CSSProperties}
						className="border-border bg-surface hover:bg-surface-hover text-text focus-visible:outline-accent panel-in card-lift w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 max-md:min-h-11"
					>
						{example}
					</button>
				))}
			</div>
		</div>
	)
}

export function ChatWorkspace() {
	const queryClient = useQueryClient()
	const [sidebarOpen, setSidebarOpen] = useState(false)

	// After a turn is persisted, refresh the history sidebar so a new thread (or
	// a reordered one) shows up without a manual reload.
	const handleTurnPersisted = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY })
	}, [queryClient])

	const {
		messages,
		conversationId,
		isStreaming,
		isLoadingConversation,
		error,
		send,
		stop,
		retry,
		reset,
		loadConversation
	} = useChat({ onTurnPersisted: handleTurnPersisted })

	const bottomRef = useRef<HTMLDivElement>(null)

	// Keep the newest turn in view as tokens stream in.
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
	}, [messages])

	const closeSidebar = useCallback(() => setSidebarOpen(false), [])
	const openSidebar = useCallback(() => setSidebarOpen(true), [])
	const hasMessages = messages.length > 0

	// Screen-reader status of the workspace. This depends only on coarse state
	// flags (never on the streaming token text), so it is announced once per
	// state transition rather than on every token.
	const statusAnnouncement = isLoadingConversation
		? 'Loading conversation.'
		: error
			? `Error: ${error}`
			: isStreaming
				? 'Jev is routing your message and streaming a response.'
				: ''

	return (
		<div className="bg-bg text-text flex h-dvh">
			<ConversationSidebar
				activeId={conversationId}
				onSelect={loadConversation}
				onNew={reset}
				mobileOpen={sidebarOpen}
				onCloseMobile={closeSidebar}
			/>

			<div className="flex min-w-0 flex-1 flex-col">
				<AppHeader
					title="Jev chat"
					subtitle="multi-model routing workspace"
					leading={
						<Button
							variant="ghost"
							size="sm"
							className="max-md:h-11 max-md:w-11 md:hidden"
							aria-label="Open conversation history"
							onClick={openSidebar}
						>
							<MenuIcon size={18} />
						</Button>
					}
				/>

				<main id="main-content" tabIndex={-1} className="relative flex-1 overflow-y-auto">
					<div aria-live="polite" role="status" className="sr-only">
						{statusAnnouncement}
					</div>
					{isLoadingConversation ? (
						// The same shimmer the dashboard and the run view use. Decorative on
						// purpose: the `role="status"` region above already announces
						// "Loading conversation.", so this must not say it twice.
						<div className="bg-bg/60 absolute inset-0 z-10 flex items-center justify-center px-4">
							<SkeletonLines lines={4} className="w-full max-w-md" />
						</div>
					) : null}
					<div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
						{hasMessages ? (
							messages.map((message) => (
								<MessageBubble
									key={message.id}
									message={message}
									onRetry={message.role === 'assistant' ? retry : undefined}
								/>
							))
						) : (
							<EmptyState onPick={send} />
						)}
						<div ref={bottomRef} />
					</div>
				</main>

				{error ? (
					<div className="border-danger/40 bg-danger/10 text-danger mx-auto w-full max-w-3xl px-4">
						<div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
							<AlertIcon size={16} className="shrink-0" />
							<span className="flex-1 break-words">{error}</span>
							<Button variant="outline" size="sm" onClick={retry}>
								Retry
							</Button>
						</div>
					</div>
				) : null}

				<footer className="border-border bg-surface border-t px-4 py-3">
					<div className="mx-auto w-full max-w-3xl">
						<ChatInput onSend={send} onStop={stop} disabled={isStreaming} />
						<p className="text-text-faint mt-2 text-center text-xs">
							Enter to send · Shift+Enter for a newline · routed live by Jev
						</p>
					</div>
				</footer>
			</div>
		</div>
	)
}
