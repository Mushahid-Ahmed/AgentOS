'use client'

import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode
} from 'react'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'
import {
	isSeen,
	ownsPage,
	pageOpacity,
	pageTransform,
	pageU,
	sceneDepth
} from '@/lib/motion/page-depth'

// V7 — a 3D zoom-out camera over the landing's section stack (lusion.co/about,
// mapped onto AgentOS's own pages). The rig never renders a transform: it writes
// them from one rAF loop, only while a page is inside the handoff band, so the
// server HTML and the resting DOM stay exactly as V6 left them.
//
// Registry entries hold LAYOUT metrics (document top + height), re-read with the
// written transforms cleared. That is what lets the camera work in true document
// coordinates while every existing rect-reading system inside a settled page keeps
// reading unprojected boxes.

type Entry = {
	el: HTMLElement
	top: number
	h: number
	/** eased position of the page, what the camera currently shows */
	u: number
	/** where the scroll says the page should be */
	target: number
	written: string
}

type Rig = {
	register: (el: HTMLElement) => () => void
}

const V7Context = createContext<Rig | null>(null)

/** The camera needs real depth cues, so below this width it stands down entirely. */
const WIDE_QUERY = '(min-width: 1024px)'

/** Inertia: how much of the remaining distance the camera closes per frame. */
const LERP = 0.14

export function V7Camera({ children }: { children: ReactNode }) {
	const reduced = useReducedMotion()
	const [wide, setWide] = useState(true)
	const entries = useRef<Entry[]>([])
	const dirty = useRef(true)
	const backdrop = useRef<HTMLDivElement>(null)
	const rail = useRef<HTMLDivElement>(null)
	const bead = useRef<HTMLDivElement>(null)
	const active = useRef(0)
	const [pages, setPages] = useState(0)

	useEffect(() => {
		const mql = window.matchMedia(WIDE_QUERY)
		const onChange = () => setWide(mql.matches)
		onChange()
		mql.addEventListener('change', onChange)
		return () => mql.removeEventListener('change', onChange)
	}, [])

	const live = wide && !reduced

	// One rAF loop for the whole page: no per-section listeners, and it parks
	// itself once every page has converged on its target.
	useEffect(() => {
		// The rail is a position indicator, not an animation, so both arms paint it.
		// The transform work is what reduced motion and narrow screens stand down from.
		let docSpan = 0
		let railWritten = ''
		let tintWritten = ''
		let beadWritten = ''
		let motionWritten = ''
		// One attribute, written only when the rig starts or stops moving: the rail's
		// decorative loops pause with the rAF loop instead of outliving it, which is how
		// V6 already treats .v6-march/.v6-hub/.v6-marquee. Paused, not removed — they
		// resume on their own phase the moment a handoff begins.
		const setMotion = (state: 'live' | 'idle') => {
			if (motionWritten === state) return
			motionWritten = state
			if (rail.current) rail.current.dataset.v7Motion = state
		}
		const paintRail = (us: number[], vh: number) => {
			const host = rail.current
			const leaf = bead.current
			if (!host || !leaf || us.length < 2) return
			// The document is only re-measured when something can have changed its length
			// (measure(), which runs on resize and on the ResizeObserver), so the indicator
			// never forces layout inside an animating frame.
			if (docSpan <= 0) docSpan = Math.max(1, document.documentElement.scrollHeight - vh)
			const p = (window.scrollY / docSpan).toFixed(4)
			// --v7-progress is consumed only by the bead, but custom properties are
			// INHERITED: written on the rail host it dirties the host and all eleven ticks
			// every frame, which measured ~7ms/frame of style recalc at a 4x throttle. On
			// the leaf it costs one element, and only when the value actually moved.
			if (p !== railWritten) {
				railWritten = p
				leaf.style.setProperty('--v7-progress', p)
			}
			// The rail's active tick is the page the camera is nearest to. It only
			// touches the DOM when that changes, which is once per handoff.
			let best = 0
			for (let i = 1; i < us.length; i++) {
				if (Math.abs(us[i] ?? 0) < Math.abs(us[best] ?? 0)) best = i
			}
			if (best !== active.current) {
				const prev = host.children[active.current] as HTMLElement | undefined
				const nextEl = host.children[best] as HTMLElement | undefined
				if (prev?.hasAttribute('data-v7-tick')) prev.removeAttribute('data-v7-active')
				if (nextEl?.hasAttribute('data-v7-tick')) nextEl.setAttribute('data-v7-active', 'true')
				active.current = best
			}
		}

		const clear = () => {
			for (const e of entries.current) {
				e.el.style.transform = ''
				e.el.style.opacity = ''
				e.el.style.willChange = ''
				e.u = 0
				e.written = ''
			}
		}

		// The tint and the bead travel with the scene, so a rig that stands down partway
		// through a handoff takes them back with it instead of leaving the scene frozen
		// mid-recede.
		const clearScene = () => {
			const b = backdrop.current
			if (b) {
				b.style.opacity = ''
				b.style.willChange = ''
			}
			const leaf = bead.current
			if (leaf) leaf.style.opacity = ''
		}

		if (!live) {
			// The OFF arm still reads where each page is — with nothing written, every
			// rect it reads is layout truth.
			const staticRail = () => {
				const vh = window.innerHeight || 1
				const vc = window.scrollY + vh / 2
				paintRail(
					entries.current.map((e) => {
						const b = e.el.getBoundingClientRect()
						return pageU(b.top + window.scrollY + b.height / 2, b.height, vc, vh)
					}),
					vh
				)
			}
			// Only a resize can change the document's length here; a scroll cannot.
			const staticResize = () => {
				docSpan = 0
				staticRail()
			}
			clear()
			clearScene()
			staticResize()
			window.addEventListener('scroll', staticRail, { passive: true })
			window.addEventListener('resize', staticResize)
			return () => {
				window.removeEventListener('scroll', staticRail)
				window.removeEventListener('resize', staticResize)
				clearScene()
			}
		}

		let raf = 0
		let idle = 0

		const measure = () => {
			const sy = window.scrollY
			docSpan = 0
			// Transforms are paint-only, so they have to be taken off before the read
			// returns layout truth. Nothing else in this loop writes during the read.
			for (const e of entries.current) {
				e.el.style.transform = ''
				e.el.style.opacity = ''
				// Destroying a write destroys the record of it. Without this the next frame
				// finds its own string still cached in e.written, skips the write, and leaves
				// a page that should be receded sitting flat at identity with its will-change
				// still on it — which is what every debounced re-measure used to do.
				e.written = ''
			}
			for (const e of entries.current) {
				const r = e.el.getBoundingClientRect()
				e.top = r.top + sy
				e.h = r.height
			}
			dirty.current = true
		}

		const frame = () => {
			raf = 0
			setMotion('live')
			const vh = window.innerHeight || 1
			const sy = window.scrollY
			const vc = sy + vh / 2
			const list = entries.current

			let moving = false
			const us: number[] = []
			const seen: number[] = []

			for (let i = 0; i < list.length; i++) {
				const e = list[i]
				if (!e) continue
				const next = pageU(e.top + e.h / 2, e.h, vc, vh)
				e.target = next
				const stepped = e.u + (next - e.u) * LERP
				const value = Math.abs(next - stepped) < 0.0008 ? next : stepped
				if (value !== e.u) moving = true
				e.u = value
				us.push(value)
				const visible = isSeen(e.top, e.h, sy, vh)
				// The backdrop is the space behind the pages the reader can see receding, so
				// only pages overlapping the viewport count. Every page in the document
				// contributes to a max, and a page two sections away is always fully gone: that
				// pinned the tint at 0.85 at every scroll position, rest included, and kept a
				// promoted full-viewport layer alive for a scene nothing was leaving.
				if (visible) seen.push(value)

				// The same rule decides what gets a transform. A page entirely off screen is at
				// the ceiling of its recession whatever else is true about it, and holding it
				// there costs a full-size compositor layer: parked over the hero this build kept
				// ten promoted pages against the control's zero, which is the at-rest frame gap.
				// Writing starts the frame a page's edge crosses the fold — where its depth is
				// exactly the value an off-screen page was already given — so the zoom-in the
				// reader sees is unchanged, the rig just stops paying for pages nobody can see.
				const tf = visible && ownsPage(e.h, vh) ? pageTransform(value, vh, i) : 'none'
				if (tf !== e.written) {
					e.written = tf
					e.el.style.transform = tf
					e.el.style.opacity = tf === 'none' ? '' : pageOpacity(value).toFixed(3)
					// will-change is what would make this page a containing block for its
					// own fixed descendants, so it only exists for the length of a move.
					e.el.style.willChange = tf === 'none' ? '' : 'transform, opacity'
				}
			}

			const d = sceneDepth(seen)
			const b = backdrop.current
			if (b) {
				// Quantised so a hand that has converged writes nothing at all.
				const tint = d < 0.0005 ? '0' : (d * 0.85).toFixed(3)
				if (tint !== tintWritten) {
					tintWritten = tint
					// The tint is a full-viewport radial gradient, so every frame it is
					// visible repainted the whole screen; that is the backdrop's measured
					// ~9% share. Promote it to its own layer only while it is on screen, and
					// hand the layer back at rest so an invisible scene costs nothing.
					b.style.willChange = tint === '0' ? '' : 'opacity'
					b.style.opacity = tint
				}
			}
			paintRail(us, vh)
			const leaf = bead.current
			if (leaf) {
				const glow = (0.35 + d * 0.65).toFixed(3)
				if (glow !== beadWritten) {
					beadWritten = glow
					leaf.style.opacity = glow
				}
			}

			if (moving || dirty.current) {
				dirty.current = false
				idle = 0
				raf = requestAnimationFrame(frame)
			} else {
				// Plain assignment, never idle++: the React Compiler is set to
				// panicThreshold all_errors and rejects an update expression on a
				// binding captured by a lambda.
				idle = idle + 1
				if (idle < 8) raf = requestAnimationFrame(frame)
				else setMotion('idle')
			}
		}

		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(frame)
		}

		const onResize = () => {
			measure()
			schedule()
		}

		measure()
		schedule()
		window.addEventListener('scroll', schedule, { passive: true })
		window.addEventListener('resize', onResize)

		// Section heights change after the first paint (webfonts, the 600svh pin,
		// images), and the camera works in document coordinates, so it re-measures
		// when the document does. Debounced: a measure pass clears every written
		// transform for one frame.
		let settle = 0
		const ro = new ResizeObserver(() => {
			window.clearTimeout(settle)
			settle = window.setTimeout(onResize, 180)
		})
		ro.observe(document.documentElement)

		return () => {
			if (raf) cancelAnimationFrame(raf)
			window.clearTimeout(settle)
			ro.disconnect()
			window.removeEventListener('scroll', schedule)
			window.removeEventListener('resize', onResize)
			clear()
			clearScene()
		}
	}, [live])

	// A page that mounts or unmounts shifts every page below it.
	useEffect(() => {
		if (pages === 0) return
		const t = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 60)
		return () => window.clearTimeout(t)
	}, [pages])

	const api = useMemo<Rig>(
		() => ({
			register(el: HTMLElement) {
				const entry: Entry = { el, top: 0, h: 0, u: 0, target: 0, written: '' }
				entries.current = [...entries.current, entry]
				dirty.current = true
				setPages((n) => n + 1)
				return () => {
					entries.current = entries.current.filter((e) => e !== entry)
					el.style.transform = ''
					el.style.opacity = ''
					el.style.willChange = ''
					setPages((n) => n - 1)
				}
			}
		}),
		[]
	)

	return (
		<V7Context.Provider value={api}>
			{children}
			<V7Backdrop ref={backdrop} />
			<V7Rail count={pages} rail={rail} bead={bead} />
		</V7Context.Provider>
	)
}

/** The scene the pages recede into. Transparent at rest, so the tint only exists
    for as long as a handoff is in flight — the page never looks different while
    you are reading it. Colours are the design tokens, no new values. */
function V7Backdrop({ ref }: { ref: React.RefObject<HTMLDivElement | null> }) {
	return (
		<div
			ref={ref}
			aria-hidden
			className="pointer-events-none fixed inset-0 -z-10 opacity-0"
			style={{
				background:
					'radial-gradient(120% 90% at 50% 42%, color-mix(in oklab, var(--surface) 92%, var(--accent) 8%) 0%, var(--bg) 72%)'
			}}
		/>
	)
}

/** Lusion's scroll indicator, redrawn in the V6 line language: a hairline rail,
    one tick per page, a bead that travels the rail, and the active tick drawn out
    into a line by a keyframe the rig never has to touch. */
function V7Rail({
	count,
	rail,
	bead
}: {
	count: number
	rail: React.RefObject<HTMLDivElement | null>
	bead: React.RefObject<HTMLDivElement | null>
}) {
	if (count < 2) return null
	return (
		<div
			aria-hidden
			className="pointer-events-none fixed top-1/2 right-4 z-40 hidden -translate-y-1/2 lg:block"
		>
			<div
				ref={rail}
				data-v7-rail
				className="flex flex-col items-end gap-3"
				style={{ '--v7-pages': String(count) } as CSSProperties}
			>
				{Array.from({ length: count }, (_, i) => (
					<span
						key={i}
						data-v7-tick
						className="bg-text-faint/40 h-px w-2 origin-right"
						style={{ '--v7-i': i } as CSSProperties}
					/>
				))}
				<div ref={bead} data-v7-bead className="bg-accent absolute right-0 h-2 w-2 rounded-full" />
			</div>
		</div>
	)
}

/** One page in the camera's world. The wrapper is layout-neutral: it adds no box
    of its own to the document, so page count never changes the scroll length. */
export function V7Page({
	id,
	children,
	className
}: {
	id: string
	children: ReactNode
	className?: string
}) {
	const rig = useContext(V7Context)
	const el = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const node = el.current
		if (!node || !rig) return
		return rig.register(node)
	}, [rig])

	return (
		<div ref={el} data-v7-page={id} className={cn('relative', className)}>
			{children}
		</div>
	)
}
