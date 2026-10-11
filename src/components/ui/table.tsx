import { cn } from '@/lib/cn'

// Shared data-table primitives (UIUX brief Phase 1). One hairline-ruled table
// style used by every screen instead of hand-rolled <table> markup: no heavy
// borders or zebra fills, tabular figures for numeric cells, and a visually
// hidden caption so a screen reader announces what the table is. Wide tables
// scroll inside their own container (TableScroll) so the page never scrolls
// horizontally.

export function TableScroll({ className, ...props }: React.ComponentProps<'div'>) {
	return <div className={cn('-mx-1 overflow-x-auto px-1', className)} {...props} />
}

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
	return <table className={cn('w-full border-collapse text-sm', className)} {...props} />
}

export function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
	// sr-only by default: the caption is for assistive tech, not a visible title
	// (the surrounding Card/section carries the visible heading). Pass a className
	// to override if a visible caption is ever wanted.
	return <caption className={cn('sr-only', className)} {...props} />
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
	return <thead className={cn(className)} {...props} />
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
	return <tbody className={cn(className)} {...props} />
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
	return <tr className={cn('border-border/60 border-b last:border-0', className)} {...props} />
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
	return (
		<th
			scope="col"
			className={cn(
				'text-text-muted px-2 py-2 text-left text-xs font-medium tracking-wide whitespace-nowrap',
				className
			)}
			{...props}
		/>
	)
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
	return <td className={cn('px-2 py-2 align-middle', className)} {...props} />
}

// A row-header cell (first column) — semantically a <th scope="row">.
export function TableRowHead({ className, ...props }: React.ComponentProps<'th'>) {
	return (
		<th
			scope="row"
			className={cn('text-text px-2 py-2 text-left font-medium', className)}
			{...props}
		/>
	)
}

// Numeric cell: mono + tabular figures so digits don't jitter as values change.
export function TableNum({ className, ...props }: React.ComponentProps<'td'>) {
	return <td className={cn('font-numeric px-2 py-2', className)} {...props} />
}
