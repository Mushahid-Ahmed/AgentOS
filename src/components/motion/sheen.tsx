'use client'

// Pointer-follow specular highlight for panels. A wrapper that records the
// pointer position as CSS custom properties (--mx/--my, as percentages of the
// element) on pointermove; the `.sheen::after` rule in globals.css paints a soft
// accent radial at that point, fading in on hover. Writing to CSS vars on the
// node (not React state) keeps it off the render path.
//
// Use it deliberately on hero panels rather than every card — each instance
// adds a pointermove listener, and the effect is meant to draw the eye, not to
// be everywhere at once.

import { useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Sheen({
	children,
	className,
	as: Tag = 'div'
}: {
	children: ReactNode
	className?: string
	as?: 'div' | 'section' | 'article'
}) {
	const ref = useRef<HTMLDivElement>(null)

	const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
		const el = ref.current
		if (!el) return
		const rect = el.getBoundingClientRect()
		el.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width) * 100}%`)
		el.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height) * 100}%`)
	}

	return (
		<Tag
			ref={ref as React.Ref<HTMLDivElement>}
			onPointerMove={onPointerMove}
			className={cn('sheen overflow-hidden rounded-lg', className)}
		>
			{children}
		</Tag>
	)
}
