import { cn } from '@/lib/cn'

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			// Hairline border, no shadow — the editorial surfaces separate regions
			// with whitespace and 1px rules, not drop shadows (UIUX brief Phase 2).
			// `min-w-0`: a Card is a grid/flex item, and those default to
			// `min-width:auto`, i.e. never narrower than their content's min-content
			// width. The data tables inside pin themselves to `min-w-[640px]` and
			// scroll in their own TableScroll, so without this clamp that floor
			// propagated through the Card into the track and widened <main>
			// horizontally at 375px — invisible content, real scrollbar.
			className={cn('border-border bg-surface min-w-0 rounded-lg border', className)}
			{...props}
		/>
	)
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
	return <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
	// Section titles use the editorial serif (the single display face) via the
	// shared .title-editorial utility, so they read identically to the landing
	// page's column titles on every screen.
	return <h3 className={cn('title-editorial text-text', className)} {...props} />
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
	return <p className={cn('text-text-muted text-sm', className)} {...props} />
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
	return <div className={cn('p-6 pt-0', className)} {...props} />
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
	return <div className={cn('flex items-center p-6 pt-0', className)} {...props} />
}
