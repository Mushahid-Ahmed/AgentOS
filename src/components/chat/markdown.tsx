'use client'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/cn'
import { CheckIcon, CopyIcon } from '@/components/ui/icons'

// Markdown renderer for assistant answers. react-markdown + remark-gfm (tables,
// strikethrough, autolinks). Fenced code blocks get a header with the language
// and a copy button — the spec calls for copyable code. Client component: the
// copy button holds state, and this only ever renders inside the client chat
// workspace.

function CodeBlock({ language, value }: { language?: string; value: string }) {
	const [copied, setCopied] = useState(false)

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(value)
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		} catch {
			// Clipboard unavailable (permissions/insecure context) — fail quietly;
			// the code is still selectable.
		}
	}

	return (
		<div className="border-border bg-surface-hover my-3 overflow-hidden rounded-lg border">
			<div className="border-border text-text-faint flex items-center justify-between border-b px-3 py-1.5">
				<span className="font-mono text-xs">{language || 'text'}</span>
				<button
					type="button"
					onClick={onCopy}
					aria-label={copied ? 'Copied' : 'Copy code'}
					className="text-text-muted hover:text-text focus-visible:outline-accent inline-flex items-center gap-1 rounded text-xs transition-colors focus-visible:outline focus-visible:outline-2"
				>
					{copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
					{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
			<pre className="text-text overflow-x-auto p-3 text-sm leading-relaxed">
				<code className="font-mono">{value}</code>
			</pre>
		</div>
	)
}

export function Markdown({ content, className }: { content: string; className?: string }) {
	return (
		<div
			className={cn(
				'text-text text-sm leading-relaxed',
				// Prose-ish spacing without pulling in @tailwindcss/typography.
				'[&_p]:my-2 [&_p]:first:mt-0 [&_p]:last:mb-0',
				'[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
				'[&_li]:my-1',
				'[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold',
				'[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold',
				'[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold',
				'[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2',
				'[&_blockquote]:border-border [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic',
				'[&_hr]:border-border [&_hr]:my-4',
				'[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse',
				'[&_th]:border-border [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
				'[&_td]:border-border [&_td]:border [&_td]:px-2 [&_td]:py-1',
				className
			)}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					// Let CodeBlock own the whole block; drop the default <pre> wrapper.
					pre: ({ children }) => <>{children}</>,
					// Overriding `table` REPLACES the element, so the <table> has to be
					// re-emitted inside the scroller — a bare <div> would put <thead> in
					// flow content and descope the [&_table] rules. Focusable because the
					// wide-table case is now scrolled here rather than by the page, and a
					// keyboard user must be able to reach the clipped columns.
					table: ({ children }) => (
						<div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
							<table>{children}</table>
						</div>
					),
					code: ({ className: codeClass, children }) => {
						const match = /language-(\w+)/.exec(codeClass || '')
						const value = String(children).replace(/\n$/, '')
						// A language tag, or any embedded newline, means a fenced block.
						if (match || value.includes('\n')) {
							return <CodeBlock language={match?.[1]} value={value} />
						}
						return (
							<code className="border-border/60 bg-surface-hover text-text rounded border px-1 py-0.5 font-mono text-[0.85em]">
								{children}
							</code>
						)
					}
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	)
}
