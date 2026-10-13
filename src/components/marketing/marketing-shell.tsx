import { cn } from '@/lib/cn'

// The shared canvas for the auth surfaces (/login, /signup) on the ONE dark
// system (UI/UX run M5): a near-black page holding one elevated panel with a
// hairline edge, and a header row for the brand + the swapped top-right action.
// The landing uses its own chrome but the same tokens, so all three read as one
// product.
export function MarketingShell({
	brand,
	topRight,
	children,
	className
}: {
	brand?: React.ReactNode
	topRight?: React.ReactNode
	children: React.ReactNode
	className?: string
}) {
	return (
		<div className="bg-bg min-h-dvh p-1 sm:p-1.5">
			<div
				className={cn(
					'bg-surface border-border relative flex min-h-[calc(100dvh-8px)] flex-col overflow-hidden rounded-[22px] border sm:min-h-[calc(100dvh-12px)]',
					className
				)}
			>
				{/* Animated background (brief §7.2-2): two accent gradient lobes on long
				    transform loops. CSS-only on purpose — the auth routes stay WebGL-free. */}
				<div aria-hidden="true" className="auth-aurora" />
				{/* One accent hairline: the electric-blue identity cue, centred so it
				    fades out at both ends instead of reading as a border. */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 top-0 h-px"
					style={{
						background: 'linear-gradient(90deg, transparent, var(--accent), transparent)'
					}}
				/>
				<header className="relative z-10 flex items-center justify-between gap-4 px-5 pt-4 pb-2 sm:px-6">
					<div className="min-w-0">{brand}</div>
					<div className="shrink-0">{topRight}</div>
				</header>
				<main id="main-content" tabIndex={-1} className="relative z-10 flex flex-1 flex-col">
					{children}
				</main>
			</div>
		</div>
	)
}
