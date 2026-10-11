'use client'
import { useEffect, useRef, useState } from 'react'
import { createFluidLayer } from '@/lib/motion/fluid-layer'
import { prefersReducedMotion, useReducedMotion } from '@/lib/motion/use-reduced-motion'

// The hero's WebGL fluid layer (Take 2, §4). This component only mounts and
// unmounts the engine in `lib/motion/fluid-layer` — the engine lives outside the
// component because Next 16's React Compiler reads `gl.useProgram()` inside a
// component body as a React hook call and rejects the file.
//
// Reduced motion, or any GL capability/compile failure, falls back to a static
// layered gradient: the hero is never blank and no content waits on animation.
// `data-t2-fallback` names the reason, which the verification harness asserts.
export function HeroFluid({ className }: { className?: string }) {
	const ref = useRef<HTMLCanvasElement>(null)
	const reduced = useReducedMotion()
	const [reason, setReason] = useState<string | null>(null)

	useEffect(() => {
		const canvas = ref.current
		// `reduced` starts false so server and client markup agree, which means this
		// effect's first run happens before the hook has read the media query. Ask the
		// query directly — otherwise every reduced-motion visit pays for a real WebGL
		// context that is thrown away on the next render.
		if (!canvas || reduced || prefersReducedMotion()) return
		const layer = createFluidLayer(canvas)
		if (layer.reason) setReason(layer.reason)
		return layer.stop
	}, [reduced])

	if (reduced || reason) {
		return (
			<div
				aria-hidden
				data-t2-fallback={reduced ? 'reduced-motion' : reason}
				className={className}
				style={{
					background:
						'radial-gradient(70% 55% at 24% 30%, rgba(91,124,250,0.30), transparent 62%),' +
						'radial-gradient(60% 50% at 78% 68%, rgba(138,188,237,0.20), transparent 60%),' +
						'radial-gradient(50% 40% at 55% 88%, rgba(112,101,226,0.18), transparent 65%), var(--bg)'
				}}
			/>
		)
	}

	return <canvas ref={ref} aria-hidden="true" className={className} />
}
