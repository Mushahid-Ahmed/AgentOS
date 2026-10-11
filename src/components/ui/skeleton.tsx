import { cn } from '@/lib/cn'

// Loading skeleton: a moving specular band over a surface-hover base (the
// `.skeleton` keyframe lives in globals.css and is collapsed under
// prefers-reduced-motion by the global guard). Size it with className, e.g.
// `h-4 w-40` for a line or `h-24 w-full` for a block. Decorative — hidden from
// assistive tech; the surrounding region should carry an aria-busy or a text
// "Loading…" label instead.
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
	return <div aria-hidden className={cn('skeleton rounded', className)} {...props} />
}

// A small stack of skeleton lines, for list/table/paragraph placeholders.
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
	return (
		<div aria-hidden className={cn('flex flex-col gap-2', className)}>
			{Array.from({ length: lines }, (_, i) => (
				<Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
			))}
		</div>
	)
}

// The shimmer IS the visible loading affordance, so the text has to live in the
// accessibility layer instead: `role="status"` announces it and assistive tech
// gets the real words rather than a decorative block.
export function SkeletonBlock({
	lines = 3,
	label,
	className
}: {
	lines?: number
	label: string
	className?: string
}) {
	return (
		<div role="status" aria-busy="true" className={cn('flex flex-col gap-2', className)}>
			<SkeletonLines lines={lines} />
			<span className="sr-only">{label}</span>
		</div>
	)
}
