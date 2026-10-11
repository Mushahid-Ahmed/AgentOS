import { ViewNav } from '@/components/nav/view-nav'
import { cn } from '@/lib/cn'

// The shared in-app header (UIUX brief M3). The chat workspace, dashboard and
// AgentOS run view each used to hand-roll a near-identical chrome bar; this is
// the single version so all three read as the same product as the landing.
//
// Visual-only: it renders the view switcher and sign-out, then the same title
// voice as the landing (`.title-editorial` is the one grotesque display face),
// so every view carries the landing's identity. `titleClassName` remains
// available for a view that genuinely needs a different treatment. `leading` is
// an optional slot before the title — the chat workspace puts its mobile
// sidebar button there.
//
// There is deliberately no theme control: the product ships ONE dark system
// across all six surfaces (UX-D1), so a light/dark switch would be a dead
// button (UX-D20).
export function AppHeader({
	title,
	subtitle,
	leading,
	titleClassName,
	className
}: {
	title: string
	subtitle?: string
	leading?: React.ReactNode
	titleClassName?: string
	className?: string
}) {
	return (
		<header
			className={cn(
				'border-border bg-surface/80 relative z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 backdrop-blur-md',
				className
			)}
		>
			{leading}
			<div className="flex min-w-0 items-baseline gap-2">
				<h1 className={cn('title-editorial text-text shrink-0', titleClassName)}>{title}</h1>
				{subtitle ? (
					<span className="label-uppercase text-text-faint hidden min-w-0 truncate lg:inline">
						{subtitle}
					</span>
				) : null}
			</div>
			<ViewNav className="ml-auto" />
		</header>
	)
}
