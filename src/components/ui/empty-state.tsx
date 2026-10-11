import { DoorIllustration } from '@/components/marketing/door-illustration'
import { cn } from '@/lib/cn'

// Shared empty / loading-placeholder state (UIUX brief Phase 2: "reuse the door
// illustration in empty states, loading, 404 and error screens"). Calm, centred,
// serif title, gray body, optional action. The door inherits the current text
// colour (text-text-muted here) so it reads correctly on both light and dark
// surfaces — never the static marketing ink.
export function EmptyState({
	title,
	body,
	action,
	illustrate = true,
	className
}: {
	title: string
	body?: string
	action?: React.ReactNode
	illustrate?: boolean
	className?: string
}) {
	return (
		<div
			className={cn(
				'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
				className
			)}
		>
			{illustrate ? (
				<DoorIllustration className="text-text-muted h-20 w-24 opacity-60" />
			) : null}
			<h3 className="title-editorial text-text">{title}</h3>
			{body ? (
				<p className="text-text-muted max-w-sm text-sm leading-relaxed">{body}</p>
			) : null}
			{action ? <div className="mt-1">{action}</div> : null}
		</div>
	)
}
