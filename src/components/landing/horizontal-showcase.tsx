'use client'

import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'
import { FadeUp } from '@/components/motion/reveal'

gsap.registerPlugin(ScrollTrigger)

// Pinned horizontal product showcase (brief §6.2-7, DownBeat technique).
// The five panels are the app's OWN surfaces — Chat, Dashboard, Run view,
// Evidence, Replay — drawn as abstract code schematics (UX-D7): no fabricated
// screenshots, no invented UI. Under reduced motion or on narrow screens the
// same content renders as a plain vertical stack, fully visible.

function useIsWide(): boolean {
	const [wide, setWide] = useState(false)

	useEffect(() => {
		const mql = window.matchMedia('(min-width: 1024px)')
		const onChange = () => setWide(mql.matches)
		onChange()
		mql.addEventListener('change', onChange)
		return () => mql.removeEventListener('change', onChange)
	}, [])

	return wide
}

const LINE = 'bg-border-strong/70 h-2 rounded-full'

function Mini({ tag, children }: { tag: string; children: React.ReactNode }) {
	return (
		<div className="border-border bg-surface relative aspect-16/10 w-full overflow-hidden rounded-xl border shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
			<div className="border-border bg-surface-hover absolute inset-x-0 top-0 flex h-8 items-center gap-1.5 border-b px-3">
				<span className="bg-border-strong size-1.5 rounded-full" />
				<span className="bg-border-strong size-1.5 rounded-full" />
				<span className="text-text-faint ml-2 font-mono text-[10px] tracking-[0.14em] uppercase">
					{tag}
				</span>
			</div>
			<div className="absolute inset-0 pt-8">{children}</div>
		</div>
	)
}

function ChatMini() {
	return (
		<Mini tag="chat">
			<div className="flex h-full">
				<div className="flex flex-1 flex-col items-end gap-2 p-4">
					<div className="bg-accent/30 h-3 w-1/2 rounded-full" />
					<div className="bg-accent/30 h-3 w-2/5 rounded-full" />
					<div className={cn(LINE, 'mt-3 w-3/4 self-start')} />
					<div className={cn(LINE, 'w-2/3 self-start opacity-80')} />
					<div className={cn(LINE, 'w-3/5 self-start opacity-60')} />
					<div className="bg-accent h-2 w-8 self-start rounded-full opacity-90" />
				</div>
				<div className="border-border flex w-2/5 flex-col gap-2 border-l p-4">
					{['researcher · gemini', 'critic · gpt', 'synthesizer · claude'].map((a) => (
						<div
							key={a}
							className="border-border bg-surface-hover flex items-center gap-2 rounded-md border px-2 py-1.5"
						>
							<span className="bg-accent/70 size-1.5 shrink-0 rounded-full" />
							<span className="text-text-faint truncate font-mono text-[9px]">{a}</span>
						</div>
					))}
				</div>
			</div>
		</Mini>
	)
}

function DashboardMini() {
	const families = [
		{ name: 'claude', fill: 'w-4/5', color: 'bg-[var(--series-1)]' },
		{ name: 'gpt', fill: 'w-3/5', color: 'bg-[var(--series-2)]' },
		{ name: 'gemini', fill: 'w-2/5', color: 'bg-[var(--series-3)]' }
	]
	return (
		<Mini tag="dashboard">
			<div className="grid h-full grid-cols-5 gap-3 p-4">
				<div className="border-border col-span-3 flex flex-col justify-center gap-3 rounded-lg border p-3">
					{families.map((f) => (
						<div key={f.name} className="flex items-center gap-2">
							<span className="text-text-faint w-14 truncate font-mono text-[9px]">{f.name}</span>
							<div className="bg-surface-hover h-2 flex-1 rounded-full">
								<div className={cn('h-2 rounded-full', f.color, f.fill)} />
							</div>
						</div>
					))}
				</div>
				<div className="col-span-2 flex flex-col justify-center gap-2">
					{['cap · daily', 'cap · monthly', 'cap · run'].map((c, i) => (
						<div key={c} className="border-border rounded-lg border p-2">
							<span className="text-text-faint block font-mono text-[8px]">{c}</span>
							<div className="bg-surface-hover mt-1.5 h-1.5 rounded-full">
								<div
									className={cn('bg-accent/70 h-1.5 rounded-full', ['w-1/3', 'w-2/3', 'w-1/4'][i])}
								/>
							</div>
						</div>
					))}
				</div>
			</div>
		</Mini>
	)
}

function RunViewMini() {
	const events = [
		{ label: 'plan', who: 'jev', w: 'w-1/3' },
		{ label: 'team assembled', who: 'jev', w: 'w-1/2' },
		{ label: 'evidence gathered', who: 'policy', w: 'w-2/5' },
		{ label: 'critics → judge', who: 'jev', w: 'w-1/2' },
		{ label: 'PASS', who: 'policy', w: 'w-1/4' }
	]
	return (
		<Mini tag="run view">
			<div className="flex h-full flex-col justify-center gap-2.5 p-4">
				{events.map((e, i) => (
					<div key={e.label} className="flex items-center gap-2.5">
						<span
							className={cn(
								'size-2 shrink-0 rounded-full',
								i === events.length - 1 ? 'bg-accent' : 'bg-border-strong'
							)}
						/>
						<span className="text-text-muted w-28 truncate font-mono text-[9px]">{e.label}</span>
						<span className="border-border text-text-faint rounded border px-1.5 py-0.5 text-[8px]">
							{e.who}
						</span>
						<div className={cn(LINE, e.w, 'flex-1 opacity-50')} />
					</div>
				))}
			</div>
		</Mini>
	)
}

function EvidenceMini() {
	const rows = [
		{ status: 'verified', cls: 'bg-accent/20 text-accent', w: 'w-3/4' },
		{ status: 'verified', cls: 'bg-accent/20 text-accent', w: 'w-2/3' },
		{ status: 'checking', cls: 'bg-surface-hover text-text-faint', w: 'w-4/5' },
		{ status: 'source', cls: 'bg-surface-hover text-text-faint', w: 'w-1/2' }
	]
	return (
		<Mini tag="evidence">
			<div className="flex h-full flex-col gap-2 p-4">
				{rows.map((r, i) => (
					<div
						key={i}
						className="border-border flex flex-1 items-center gap-2.5 rounded-md border px-2.5"
					>
						<span
							className={cn(
								'shrink-0 rounded border border-current/30 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.12em] uppercase',
								r.cls
							)}
						>
							{r.status}
						</span>
						<div className={cn(LINE, r.w, 'flex-1 opacity-60')} />
					</div>
				))}
			</div>
		</Mini>
	)
}

function ReplayMini() {
	return (
		<Mini tag="replay">
			<div className="flex h-full flex-col justify-center gap-4 p-4">
				<div className="relative h-1.5 rounded-full bg-[var(--surface-hover)]">
					<div className="bg-accent/60 h-1.5 w-3/5 rounded-full" />
					<span className="bg-text absolute top-1/2 right-[40%] size-3 -translate-y-1/2 rounded-full" />
					{['12%', '30%', '48%', '66%', '84%'].map((t) => (
						<span
							key={t}
							className="bg-border-strong absolute top-1/2 size-1 -translate-y-1/2 rounded-full"
							style={{ left: t }}
						/>
					))}
				</div>
				<div className="flex flex-col gap-2">
					<div className={cn(LINE, 'w-4/5 opacity-70')} />
					<div className={cn(LINE, 'w-3/5 opacity-50')} />
					<div className={cn(LINE, 'w-2/3 opacity-40')} />
				</div>
			</div>
		</Mini>
	)
}

const PANELS = [
	{
		tag: 'Chat',
		title: 'One question, one assembled team',
		body: 'Jev classifies the task, the orchestra builds a researcher–critic–synthesizer lineup for that run alone — never a fixed list — and the answer streams back with its citations.',
		Mini: ChatMini
	},
	{
		tag: 'Dashboard',
		title: 'Real spend against real caps',
		body: 'Cost per run comes from tokens × curated per-1M rates, split by model family, with daily, monthly and per-run utilization shown as the caps do their job.',
		Mini: DashboardMini
	},
	{
		tag: 'Run view',
		title: 'Every decision, on the record',
		body: 'The live event stream shows the pipeline — plan, dynamic team, evidence, critics, judge — with each routing choice stamped decided_by: jev or policy.',
		Mini: RunViewMini
	},
	{
		tag: 'Evidence',
		title: 'Claims with status, not vibes',
		body: 'Findings land in a shared evidence hub where the D4 gates ask the two hard questions before an answer ships: enough evidence? evidence valid?',
		Mini: EvidenceMini
	},
	{
		tag: 'Replay',
		title: 'Runs that replay exactly',
		body: 'The event log is deterministic: scrub any finished run and watch the same decisions arrive in the same order, at the same costs.',
		Mini: ReplayMini
	}
] as const

function ShowcasePanel({
	index,
	className,
	children
}: {
	index: number
	className?: string
	children: React.ReactNode
}) {
	const pad = (n: number) => String(n).padStart(2, '0')
	return (
		<div className={cn('flex flex-col', className)}>
			<span className="text-text-muted font-mono text-[11px] tracking-[0.14em] uppercase">
				{pad(index + 1)} <span className="text-text-faint">/ {pad(PANELS.length)}</span>
			</span>
			{children}
		</div>
	)
}

function PanelCopy({ panel }: { panel: (typeof PANELS)[number] }) {
	return (
		<>
			<h3 className="font-display text-text mt-3 text-[26px] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[32px]">
				{panel.title}
			</h3>
			<p className="text-text-muted mt-2 max-w-[52ch] text-[14px] leading-[1.6]">{panel.body}</p>
		</>
	)
}

export function HorizontalShowcase() {
	const reduced = useReducedMotion()
	const wide = useIsWide()
	const pinned = wide && !reduced

	const sectionRef = useRef<HTMLElement>(null)
	const trackRef = useRef<HTMLDivElement>(null)
	const [active, setActive] = useState(0)

	useEffect(() => {
		if (!pinned) return
		const section = sectionRef.current
		const track = trackRef.current
		if (!section || !track) return

		const delta = () => Math.max(0, track.scrollWidth - section.clientWidth)

		const tween = gsap.to(track, {
			x: () => -delta(),
			ease: 'none',
			scrollTrigger: {
				trigger: section,
				start: 'top top',
				end: () => `+=${delta()}`,
				scrub: 1,
				pin: true,
				anticipatePin: 1,
				invalidateOnRefresh: true,
				onUpdate: (self) =>
					setActive(Math.min(PANELS.length - 1, Math.round(self.progress * (PANELS.length - 1))))
			}
		})

		return () => {
			tween.scrollTrigger?.kill()
			tween.kill()
		}
	}, [pinned])

	if (!pinned) {
		// Vertical fallback: same five panels, ordinary page flow, no pinning.
		return (
			<section id="surfaces" className="mx-auto w-full max-w-3xl px-6 py-20 sm:py-24">
				<span className="label-uppercase text-text-faint">The product</span>
				<h2 className="font-display text-text mt-3 text-[32px] leading-[1.08] font-bold tracking-[-0.03em]">
					Surface by surface
				</h2>
				<div className="mt-12 flex flex-col gap-16">
					{PANELS.map((panel, i) => (
						<FadeUp key={panel.tag} delay={i * 60} y={20}>
							<ShowcasePanel index={i}>
								<PanelCopy panel={panel} />
								<div className="mt-6">
									<panel.Mini />
								</div>
							</ShowcasePanel>
						</FadeUp>
					))}
				</div>
				<p className="text-text-faint mt-4 font-mono text-[10px]">
					Schematic illustrations drawn in code — not screenshots.
				</p>
			</section>
		)
	}

	return (
		<section id="surfaces" ref={sectionRef} className="bg-bg relative h-[100dvh] overflow-hidden">
			<div className="absolute top-[12vh] left-[4vw] z-10 sm:left-[6vw]">
				<span className="label-uppercase text-text-faint">The product</span>
				<h2 className="font-display text-text mt-3 text-[32px] leading-[1.05] font-bold tracking-[-0.03em] sm:text-[44px]">
					Surface by surface
				</h2>
			</div>

			{/* M12 raised this track above the V5 flow layer (z-6) so the lanes ran behind
			    the cards instead of crossing panels that had moved sideways since the lane
			    geometry was measured. V6 §1.2 removed that layer, but the z-index STAYS:
			    it is the track's stacking order against the rest of the section, and the
			    heading block still carries z-10 for the same layering. Changing it here
			    would be an unmeasured visual edit to a protected animation. */}
			<div ref={trackRef} className="relative z-[7] flex h-full w-max items-center will-change-transform">
				<div className="w-[16vw] shrink-0" />
				{PANELS.map((panel, i) => (
					<div
						key={panel.tag}
						className="flex shrink-0 items-center gap-10 pr-24"
						style={{
							// Panel transitions (§6.2-5): the panel under the headline is
							// at full weight, its neighbours recede as it arrives.
							opacity: i === active ? 1 : 0.4,
							transform: `scale(${i === active ? 1 : 0.965})`,
							transition:
								'opacity 500ms var(--ease-expo), transform 500ms var(--ease-expo)'
						}}
					>
						<ShowcasePanel index={i} className="w-[min(34vw,420px)] shrink-0">
							<PanelCopy panel={panel} />
						</ShowcasePanel>
						<div className="w-[min(48vw,640px)] shrink-0">
							<panel.Mini />
						</div>
					</div>
				))}
				<div className="w-[8vw] shrink-0" />
			</div>

			{/* Segmented scroll-progress bar (DownBeat pattern); the live segment
			    thickens to accent so the bar reads as a playhead, not a dot row. */}
			<div className="absolute bottom-10 left-1/2 flex -translate-x-1/2 items-center gap-2">
				{PANELS.map((panel, i) => (
					<span
						key={panel.tag}
						className={cn(
							'ease-expo w-12 transition-all duration-300',
							i === active ? 'bg-accent h-[3px]' : 'bg-border-strong h-px'
						)}
					/>
				))}
			</div>

			<p className="text-text-faint absolute right-[4vw] bottom-4 font-mono text-[10px]">
				Schematic illustrations drawn in code — not screenshots.
			</p>
		</section>
	)
}
