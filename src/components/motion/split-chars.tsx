'use client'
import { useRef } from 'react'
import { cn } from '@/lib/cn'
import { splitChars, useIsoLayoutEffect, type SplitUnit } from '@/lib/motion/char-split'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

export type { SplitUnit }

// Display type split into per-character elements for choreography (Take 4, M1).
//
// The caller owns the animation: `onSplit` receives the split units and returns
// an optional disposer, which runs before the split is reverted, so no tween or
// listener survives a route change.
//
// Accessibility: the full string is carried by an sr-only twin and the animated
// layer is aria-hidden, so the accessible name is the sentence once — not the
// same sentence read back as 17 separate letters. This is the pattern
// ProximityText already ships, and axe passes it.
//
// Reduced motion: no split, no twin, no hidden layer — plain visible text, which
// is the only version that cannot strand content behind an animation.
export function SplitChars({
	text,
	lines,
	as: Tag = 'div',
	className,
	lineClassName,
	ready = true,
	onSplit
}: {
	text: string
	lines: string[]
	as?: 'div' | 'h1' | 'h2' | 'h3' | 'p'
	className?: string
	lineClassName?: string
	ready?: boolean
	onSplit: (units: SplitUnit[]) => void | (() => void)
}) {
	const reduced = useReducedMotion()
	const hostRef = useRef<HTMLDivElement>(null)
	const splitCb = useRef(onSplit)
	useIsoLayoutEffect(() => {
		splitCb.current = onSplit
	})

	useIsoLayoutEffect(() => {
		if (reduced || !ready) return
		const host = hostRef.current
		if (!host) return
		const lineEls = Array.from(host.querySelectorAll<HTMLElement>('[data-split-line]'))
		if (lineEls.length === 0) return
		const instance = splitChars(lineEls)
		const dispose = splitCb.current(instance.units)
		return () => {
			if (typeof dispose === 'function') dispose()
			instance.revert()
		}
	}, [reduced, ready])

	if (reduced) {
		return (
			<Tag className={className}>
				{lines.map((line, i) => (
					<span key={i} className={cn('block', lineClassName)}>
						{line}{' '}
						{/* trailing space: the word break between block lines, so the raw
						    textContent reads "First Super AgentOS" and not "SuperAgentOS" */}
					</span>
				))}
			</Tag>
		)
	}

	return (
		<Tag className={className}>
			<span className="sr-only">{text}</span>
			<div ref={hostRef} aria-hidden="true" className="contents">
				{lines.map((line, i) => (
					<span key={i} data-split-line="" className={cn('block', lineClassName)}>
						{line}
					</span>
				))}
			</div>
		</Tag>
	)
}
