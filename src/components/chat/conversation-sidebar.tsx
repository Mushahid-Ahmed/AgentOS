'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ListConversationsResponse } from '@/lib/chat-stream'
import { Button } from '@/components/ui/button'
import { PlusIcon, TrashIcon } from '@/components/ui/icons'
import { SkeletonBlock } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'

// The history sidebar (milestone 3): lists persisted conversations, most
// recently active first, and lets the user switch threads, start a new one, or
// delete. The list is TanStack Query data; the chat route invalidates
// `conversations` after each persisted turn so a new thread appears without a
// manual refresh.
//
// The fetchers are module-level (not inline arrows) so the React Compiler never
// has to lower a `throw` inside the component body — same constraint that keeps
// the streaming loop out of useChat.

export const CONVERSATIONS_QUERY_KEY = ['conversations'] as const

async function fetchConversations(): Promise<ListConversationsResponse> {
	const response = await fetch('/api/conversations')
	if (!response.ok) throw new Error(`Failed to load conversations (${response.status})`)
	return (await response.json()) as ListConversationsResponse
}

async function requestDeleteConversation(id: string): Promise<string> {
	const response = await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
	if (!response.ok) throw new Error(`Failed to delete conversation (${response.status})`)
	return id
}

function relativeTime(iso: string): string {
	const then = new Date(iso).getTime()
	if (Number.isNaN(then)) return ''
	const seconds = Math.round((Date.now() - then) / 1000)
	if (seconds < 60) return 'just now'
	const minutes = Math.round(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.round(hours / 24)
	if (days < 7) return `${days}d ago`
	return new Date(iso).toLocaleDateString()
}

type ConversationListProps = {
	activeId: string | null
	onSelect: (id: string) => void
	onNew: () => void
}

function ConversationList({ activeId, onSelect, onNew }: ConversationListProps) {
	const queryClient = useQueryClient()
	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: CONVERSATIONS_QUERY_KEY,
		queryFn: fetchConversations
	})

	const deleteMutation = useMutation({
		mutationFn: requestDeleteConversation,
		onSuccess: (id) => {
			void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY })
			// Deleting the open thread returns the workspace to a blank new chat.
			if (id === activeId) onNew()
		}
	})

	const conversations = data?.conversations ?? []

	return (
		<div className="flex h-full flex-col">
			<div className="p-3">
				<Button variant="secondary" size="sm" className="w-full justify-start" onClick={onNew}>
					<PlusIcon size={16} />
					New chat
				</Button>
			</div>

			<div className="flex-1 overflow-y-auto px-2 pb-3">
				{isLoading ? (
					<SkeletonBlock lines={5} label="Loading conversation history" className="px-2 py-3" />
				) : isError ? (
					<div className="px-2 py-3 text-sm">
						<p className="text-danger mb-2 break-words">
							{error instanceof Error ? error.message : 'Could not load history.'}
						</p>
						<Button variant="outline" size="sm" onClick={() => refetch()}>
							Try again
						</Button>
					</div>
				) : conversations.length === 0 ? (
					<p className="text-text-faint px-2 py-3 text-sm">
						No conversations yet. Send a message to start one.
					</p>
				) : (
					<ul className="flex flex-col gap-0.5">
						{conversations.map((conversation, index) => {
							const isActive = conversation.id === activeId
							return (
								// `panel-in` with a capped index: a long history must not put the last
								// row several seconds behind the first, and the rows keep stable React
								// keys, so this runs on mount only — an invalidation after a new turn
								// re-animates just the thread that actually appeared.
								<li
									key={conversation.id}
									className="panel-in group relative"
									style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
								>
									<button
										type="button"
										onClick={() => onSelect(conversation.id)}
										aria-current={isActive ? 'true' : undefined}
										className={cn(
											'focus-visible:outline-accent rounded-control w-full px-2 py-2 pr-8 text-left transition-colors focus-visible:outline focus-visible:outline-2',
											isActive
												? 'bg-surface-hover text-text'
												: 'text-text-muted hover:bg-surface-hover hover:text-text'
										)}
									>
										<span className="block truncate text-sm font-medium">{conversation.title}</span>
										<span className="text-text-faint mt-0.5 block text-xs">
											{relativeTime(conversation.updatedAt)}
											{conversation.messageCount > 0 ? ` · ${conversation.messageCount} msgs` : ''}
										</span>
									</button>
									<button
										type="button"
										aria-label={`Delete "${conversation.title}"`}
										onClick={() => deleteMutation.mutate(conversation.id)}
										disabled={deleteMutation.isPending}
										className="text-text-faint hover:text-danger focus-visible:outline-accent absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline [@media(hover:none)]:opacity-100"
									>
										<TrashIcon size={14} />
									</button>
								</li>
							)
						})}
					</ul>
				)}
			</div>
		</div>
	)
}

export type ConversationSidebarProps = ConversationListProps & {
	mobileOpen: boolean
	onCloseMobile: () => void
}

export function ConversationSidebar({
	activeId,
	onSelect,
	onNew,
	mobileOpen,
	onCloseMobile
}: ConversationSidebarProps) {
	const list = (
		<ConversationList
			activeId={activeId}
			onSelect={(id) => {
				onSelect(id)
				onCloseMobile()
			}}
			onNew={() => {
				onNew()
				onCloseMobile()
			}}
		/>
	)

	return (
		<>
			{/* Desktop: static column. */}
			<aside className="border-border bg-surface hidden w-64 shrink-0 border-r md:block">
				{list}
			</aside>

			{/* Mobile: slide-over drawer, only mounted while open. */}
			{mobileOpen ? (
				<div className="fixed inset-0 z-40 md:hidden">
					<div
						className="bg-bg/80 absolute inset-0 backdrop-blur-sm"
						onClick={onCloseMobile}
						aria-hidden="true"
					/>
					<div className="border-border bg-surface absolute inset-y-0 left-0 w-72 max-w-[80%] border-r shadow-xl">
						{list}
					</div>
				</div>
			) : null}
		</>
	)
}
