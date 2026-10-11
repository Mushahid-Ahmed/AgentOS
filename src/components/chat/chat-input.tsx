'use client'
import { useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { ArrowRightIcon } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Magnetic } from '@/components/motion/magnetic'

// Composer. Enter sends, Shift+Enter inserts a newline, the textarea grows to a
// cap then scrolls. While a turn is streaming the send button becomes Stop so
// the user can always abort (the spec's loading/error/stop baseline).

const MAX_ROWS = 8

export function ChatInput({
	onSend,
	onStop,
	disabled
}: {
	onSend: (value: string) => void
	onStop: () => void
	disabled: boolean
}) {
	const [value, setValue] = useState('')
	const ref = useRef<HTMLTextAreaElement>(null)

	const resize = () => {
		const el = ref.current
		if (!el) return
		el.style.height = 'auto'
		const lineHeight = 20 // text-sm ~ 1.25rem
		const max = lineHeight * MAX_ROWS
		el.style.height = `${Math.min(el.scrollHeight, max)}px`
		el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
	}

	const submit = () => {
		const trimmed = value.trim()
		if (!trimmed || disabled) return
		onSend(trimmed)
		setValue('')
		// Reset height after the controlled value clears.
		requestAnimationFrame(resize)
	}

	const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault()
			submit()
		}
	}

	return (
		<div className="border-border bg-surface focus-within:outline-accent flex items-end gap-2 rounded-lg border p-2 focus-within:outline focus-within:outline-2">
			<textarea
				ref={ref}
				rows={1}
				value={value}
				placeholder="Ask anything — Jev picks the model…"
				aria-label="Message"
				onChange={(e) => {
					setValue(e.target.value)
					resize()
				}}
				onKeyDown={onKeyDown}
				className={cn(
					'text-text placeholder:text-text-faint max-h-40 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm leading-5',
					'max-md:min-h-11',
					'focus:outline-none'
				)}
				style={{ overflowY: 'hidden' }}
			/>
			{disabled ? (
				<Button variant="secondary" size="sm" className="max-md:h-11" onClick={onStop} aria-label="Stop generating">
					Stop
				</Button>
			) : (
				<Magnetic>
					<Button
						variant="primary"
						size="sm"
						className="max-md:h-11 max-sm:w-11"
						onClick={submit}
						disabled={!value.trim()}
						aria-label="Send message"
					>
						<ArrowRightIcon size={16} />
						<span className="hidden sm:inline">Send</span>
					</Button>
				</Magnetic>
			)}
		</div>
	)
}
