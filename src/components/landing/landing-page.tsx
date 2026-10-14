import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Preloader } from '@/components/landing/preloader'
import { LandingNav } from '@/components/landing/landing-nav'
import { HeroFluid } from '@/components/landing/hero-fluid'
import { HeroDisplay } from '@/components/landing/hero/hero-display'
import { HeroSubhead } from '@/components/landing/hero/subhead-blur'
import { HorizontalShowcase } from '@/components/landing/horizontal-showcase'
import { PipelineDiagram } from '@/components/landing/pipeline'
import { PipelineStage } from '@/components/landing/pipeline-stage'
import { V7Camera, V7Page } from '@/components/landing/v7-camera'
import { CableBundle } from '@/components/landing/cable-bundle'
import { RoutingStrike } from '@/components/landing/routing-strike'
import { BlueprintCorners, BlueprintFrame } from '@/components/landing/blueprint-marks'
import { KaraokeFill } from '@/components/landing/karaoke-fill'
import { ArchGrid } from '@/components/landing/arch-grid'
import { BenchChart } from '@/components/landing/bench-chart'
import { LandingFooter } from '@/components/landing/landing-footer'
import { ModelRoutes } from '@/components/landing/model-routes'
import { Faq } from '@/components/landing/faq'
import { FadeUp, LineMaskReveal } from '@/components/motion/reveal'
import { Tilt } from '@/components/motion/tilt'
import { Typewriter } from '@/components/motion/typewriter'
import { DriftMark, SweepReveal } from '@/components/motion/sweep-reveal'
import { CurtainReveal } from '@/components/motion/curtain'
import { DealStack } from '@/components/motion/deal-stack'
import { SlotNumber } from '@/components/motion/slot-counter'
import { GatherWords } from '@/components/motion/gather-words'
import { CursorField } from '@/components/motion/cursor-field'
import { GlyphField } from '@/components/motion/glyph-field'
import { Magnetic } from '@/components/motion/magnetic'
import { Parallax } from '@/components/motion/parallax'
import { RippleLayer } from '@/components/motion/ripple'
import { V5Layers } from '@/components/motion/v5-layers'
import { readLandingPreview } from '@/server/landing/public-preview'

// The content-rich, most-animated landing (brief §6.2): fifteen sections from
// preloader to footer, all copy grounded in what this repo actually ships —
// no invented metrics, pricing or claims. Static sections stay server-side;
// only the motion pieces are client components.

const SECTION = 'mx-auto w-[89%] max-w-6xl'

// One source of truth for the pipeline heading: section 5's SectionHead and the
// V6 pinned carousel's marquee (Job 2) render the same string, so the marquee
// introduces no copy of its own.
const PIPELINE_TITLE = 'Plan. Assemble. Verify. Judge.'

function SectionHead({
	kicker,
	title,
	body,
	id,
	karaoke
}: {
	kicker: string
	title: string
	body?: string
	id?: string
	// V6 §10: read the body as a karaoke sweep instead of a static paragraph. Only
	// offered where no word-level effect already exists (the hero subheadline is V4's,
	// the manifesto lines are the line-mask reveal's, the CTA heading is Gathering's).
	karaoke?: boolean
}) {
	return (
		<div id={id} className="scroll-mt-24">
			<span className="label-uppercase text-text-faint">{kicker}</span>
			{/* V4 §4's diagonal mask, on the house heading. The type is laid out and
			    painted the whole time — the parallelogram only travels across it —
			    so nothing reflows and the heading is in the accessibility tree from
			    the first frame. */}
			<h2 className="font-display text-text mt-3 max-w-[16ch] text-[32px] leading-[1.06] font-bold tracking-[-0.03em] sm:text-[44px]">
				<SweepReveal>{title}</SweepReveal>
			</h2>
			{body &&
				(karaoke ? (
					<KaraokeFill
						text={body}
						className="text-text-muted mt-4 max-w-[56ch] text-[15px] leading-[1.6]"
					/>
				) : (
					<p className="text-text-muted mt-4 max-w-[56ch] text-[15px] leading-[1.6]">{body}</p>
				))}
		</div>
	)
}

const CAPABILITIES = [
	{
		name: 'Decision Bus',
		body: 'Every routing and staffing choice is published as a recorded event with decided_by: jev or policy, so no decision is invisible.',
		icon: <path d="M3 12h18M8 12V6m8 6v6m-4-6V9m0 6v3" />
	},
	{
		name: 'Dynamic teams',
		body: 'Jev classifies the task and the orchestra assembles a researcher, critic and synthesizer lineup for that run alone, then retires it.',
		icon: <path d="M12 4v5m0 0-6 7m6-7 6 7M4 16v4m8-4v4m8-4v4" />
	},
	{
		name: 'MCP tools',
		body: 'Agents work through real tool calls (research, repo, browser) over an MCP layer, not through prompt-time pretend.',
		icon: <path d="M4 7h9m5 0h2M4 17h2m5 0h9M9 4v6m6 4v6" />
	},
	{
		name: 'Evidence hub',
		body: 'Findings land in a shared structured hub where every claim keeps its source and verification status.',
		icon: <path d="M4 8l8-4 8 4-8 4-8-4Zm0 8 8 4 8-4m-16-4 8 4 8-4" />
	},
	{
		name: 'Per-agent routing',
		body: 'Claude, GPT and Gemini via NanoGPT, picked agent by agent for cost and fit, with the cheap floor always one step away.',
		icon: <path d="M4 12h6m0 0 6-6m-6 6 6 6m-6-6h8m4 0h2" />
	},
	{
		name: 'Adversarial verification',
		body: 'Critics attack the draft, two Jev gates ask “enough evidence?” and “evidence valid?”, and a judge issues PASS or REWORK.',
		icon: <path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Zm-2.5 9 2 2 3.5-4" />
	},
	{
		name: 'Spend caps',
		body: 'Per-run, daily and monthly budgets are enforced by the engine, and cost is computed from real tokens at curated rates.',
		icon: <path d="M4 14a8 8 0 0 1 16 0M12 14l4-4M4 14h2m12 0h2" />
	},
	{
		name: 'Run replay',
		body: 'Every finished run replays from its event log: the same decisions in the same order, scrubbed like a recording.',
		icon: <path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5m4 3 4-2.5V16L8 13.5" />
	}
]

const FAMILIES = [
	{ family: 'claude', slug: 'anthropic/claude-sonnet-4.5' },
	{ family: 'gpt', slug: 'openai/gpt-4.1' },
	{ family: 'gemini', slug: 'gemini-2.5-flash' }
] as const

// The bottom of the degradation ladder: always paid, never free (D-44).
const FLOOR = { family: 'floor', slug: 'meta-llama/llama-3.3-70b-instruct', dim: true }

// Real run numbers (the newest completed four-setup benchmark run) and the Decision Bus
// log (the newest completed run's stored events) are read from the database on every
// render — V14 M2 removed the literals these used to be, so nothing on this page is a
// typed-in measurement. Data (not pre-formatted strings) so the chart and the table
// render the same numbers.
const fmtScore = (v: number) => v.toFixed(2)
const fmtCost = (v: number) => `$${v.toFixed(6)}`
const fmtLatency = (v: number) => `${v.toFixed(1)} s`

export async function LandingPage() {
	const { bench, bus, build } = await readLandingPreview()

	// Every claim in the benchmark heading is computed from the rows it summarises: the
	// per-metric winner, not a remembered sentence about run #6.
	const best = bench ? [...bench.rows].sort((a, b) => b.score - a.score)[0] : null
	const cheapest = bench ? [...bench.rows].sort((a, b) => a.cost - b.cost)[0] : null
	const fastest = bench ? [...bench.rows].sort((a, b) => a.latency - b.latency)[0] : null
	const stats = [
		{ to: 2, suffix: '', label: 'verification gates before the judge' },
		{ to: 3, suffix: '', label: 'MCP tool families agents can call' },
		...(bench
			? [{ to: bench.taskCount, suffix: '', label: 'tasks in the stored live benchmark run' }]
			: []),
		{ to: 6, suffix: '', label: 'architecture layers, D1 through D6' }
	]

	return (
		<main
			id="main-content"
			tabIndex={-1}
			className="text-text selection:bg-accent/30 selection:text-bg"
		>
			<V7Camera>
				<Preloader />
				<LandingNav />
				{/* V6 §1.2: the V5 page-wide flow-line overlay (FlowLines) is the ONE
			    animation the owner authorised removing — replaced by the per-section
			    pinned line system (Job 2 below). Everything else on this page is
			    untouched; see docs/uiux-decisions-log.md [V6][Job 2]. */}
				<V5Layers />

				{/* 3 — HERO */}
				<V7Page id="hero">
					<section className="relative flex h-[100dvh] min-h-[560px] flex-col items-center justify-center overflow-hidden bg-[var(--bg)] text-[var(--text)]">
						{/* §4's depth split: the type leaves the screen 1.5× faster than the
				    document carries it, the fluid sheet 0.5× as fast, so the two
				    separate as you scroll. The fluid itself is untouched — this wraps
				    it in a transform, it does not change the shader. */}
						<Parallax speed={0.5} className="absolute inset-0">
							<HeroFluid className="h-full w-full" />
						</Parallax>
						<div
							aria-hidden
							className="pointer-events-none absolute inset-0"
							style={{
								background: 'radial-gradient(60% 50% at 50% 42%, transparent 0%, var(--bg) 78%)'
							}}
						/>
						{/* V6 §9: the blueprint frame on the hero's own edges — measured in CSS
					    px against this section, painted at z-0 behind the type. The dotted grid
					    patch is off here: the owner asked for it back out on 2026-10-13. */}
						<BlueprintFrame grid={false} />
						<Parallax speed={1.5} className="relative z-10">
							<div className="flex flex-col items-center px-6 text-center">
								<span className="label-uppercase text-text-faint mb-6">
									Adaptive multi-agent intelligence
								</span>
								<HeroDisplay
									text="First Super AgentOS"
									lines={['First Super', 'AgentOS']}
									className="font-display font-extrabold tracking-[-0.04em]"
									lineClassName="display-huge leading-[0.95]"
								/>
								<HeroSubhead
									text="Watch Jev assemble the right AI team for every question."
									lead={1.2}
									className="text-text-muted mt-7 max-w-md text-[16px] leading-[1.6] text-balance"
								/>
								<FadeUp delay={560}>
									<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
										<Button asChild className="energy" variant="primary" size="control">
											<Link href="/signup">Sign up</Link>
										</Button>
										<Button asChild className="energy" variant="outline" size="control">
											<Link href="/login">Login</Link>
										</Button>
									</div>
								</FadeUp>
							</div>
						</Parallax>
						<div
							aria-hidden
							className="hint-breathe absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-3"
						>
							<span className="text-text-faint font-mono text-[10px] tracking-[0.2em] uppercase">
								Scroll
							</span>
							<span className="bg-border relative h-12 w-px overflow-hidden">
								<span className="scroll-dot bg-accent absolute top-0 left-0 h-3 w-px" />
							</span>
						</div>
					</section>
				</V7Page>

				{/* 4 — MANIFESTO */}
				<V7Page id="thesis">
					<section className="relative overflow-hidden py-28 sm:py-36">
						{/* §4's background element: the house mark, turning at 0.5 deg/s and
				    opening as the section passes. Decorative and aria-hidden; the
				    global reduced-motion guard stops the turn and DriftMark pins its
				    scroll scale at the resting value. */}
						<DriftMark path="M100 8 18 54v92l82 46 82-46V54Zm0 46 41 23v46l-41 23-41-23V77Z" />
						<div className={SECTION + ' relative'}>
							{/* §4 asks for both gestures on the intro: the section-wide diagonal
					    sheet, and the lines arriving from alternating sides inside it. The
					    sweep only hides ink — the paragraph keeps its box, so the two
					    mechanisms never fight over layout. */}
							<SweepReveal as="div" duration={1400} threshold={0.2}>
								<LineMaskReveal
									as="p"
									lines={[
										'A question arrives.',
										'Jev decides who works on it.',
										'The team is built for this run, then retired.',
										'Claims carry evidence. Evidence carries status.',
										'Everything is on the record.'
									]}
									// §4's "pages settling into a book": each line also arrives from
									// alternating sides with a 1.5deg tilt that unwinds as it lands.
									alternate
									stagger={130}
									className="font-display text-text text-[24px] leading-[1.3] font-medium tracking-[-0.02em] sm:text-[34px] sm:leading-[1.28]"
								/>
							</SweepReveal>
						</div>
					</section>
				</V7Page>

				{/* 5 — PIPELINE */}
				<V7Page id="pipeline">
					<section className="py-24 sm:py-28">
						<div className={`${SECTION} relative`}>
							<SectionHead
								id="pipeline"
								kicker="The pipeline"
								title={PIPELINE_TITLE}
								karaoke
								body="The D1 pipeline runs the same way every time: Jev plans, the orchestra staffs a team, evidence is gathered, critics and two verification gates pressure-test it, and a judge returns PASS or REWORK, which replans and spawns agents to close the gap."
							/>
							<FadeUp delay={120}>
								<div className="mt-12">
									<PipelineDiagram />
								</div>
							</FadeUp>
						</div>
					</section>
				</V7Page>

				{/* 5b — PINNED PIPELINE CAROUSEL (V6 Job 2). A sibling block, NOT a
			    wrapper around section 5: the scrubbed PipelineDiagram above freezes
			    inside a sticky box (useScrub measures y + rect.top, which is constant
			    under a pin), so it stays where it is and the pin gets its own 600svh
			    of scroll. */}
				<PipelineStage heading={PIPELINE_TITLE} />

				{/* 6 — CAPABILITIES */}
				<V7Page id="capabilities">
					<section id="capabilities" className="scroll-mt-20 py-24 sm:py-28">
						<div className={SECTION}>
							<SectionHead
								kicker="Capabilities"
								title="Eight things it does that a single model can’t"
							/>
							<DealStack className="border-border mt-12 grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-4">
								{CAPABILITIES.map((c) => (
									<div key={c.name} className="h-full">
										{/* The cell is the card DealStack flies out of the pile — it owns the pile
								    transform written from its own measured slot. The tilt lives on the inner
								    element, so the two transforms compose instead of overwriting each other. */}
										<Tilt glow className="h-full">
											<div className="sheen edge-glow border-border group ease-expo relative h-full border-t p-5 transition-colors duration-[var(--motion-base)] hover:bg-[var(--surface)] sm:border-l sm:first:border-l-0">
												<BlueprintCorners />
												<svg
													viewBox="0 0 24 24"
													aria-hidden
													fill="none"
													stroke="currentColor"
													strokeWidth="1.4"
													strokeLinecap="round"
													strokeLinejoin="round"
													className="tilt-depth text-text-faint group-hover:text-accent ease-expo size-7 transition-colors duration-[var(--motion-base)]"
												>
													{c.icon}
												</svg>
												<h3 className="font-display text-text mt-5 text-[16px] font-semibold tracking-[-0.01em]">
													{c.name}
												</h3>
												<p className="text-text-muted mt-2 text-[13px] leading-[1.55]">{c.body}</p>
											</div>
										</Tilt>
									</div>
								))}
							</DealStack>
						</div>
					</section>
				</V7Page>

				{/* 7 — PINNED HORIZONTAL SHOWCASE */}
				<div>
					<HorizontalShowcase />
				</div>

				{/* 8 — DECISION BUS TERMINAL */}
				<V7Page id="bus">
					<section className="py-24 sm:py-28">
						<div className={SECTION}>
							<div className="grid items-center gap-12 lg:grid-cols-2">
								<SectionHead
									kicker="The Decision Bus"
									title="If it decided, it’s on the log"
									body="Team assembly, model routes, gate outcomes and spend are each a structured event the run view renders live and replay plays back."
								/>
								{/* §5.4's curtain: the terminal is uncovered left→right instead of
						    fading up. The panel is removed from the document as soon as it
						    has left, so the reveal can never be the reason a line of the log
						    is invisible. */}
								<CurtainReveal className="min-w-0">
									{bus ? (
										<Typewriter
											lines={bus}
											className="border-border bg-surface text-text-muted max-w-full rounded-xl border p-5 text-[11.5px] leading-[1.9] sm:text-[12.5px]"
										/>
									) : (
										<p className="text-text-faint border-border bg-surface max-w-full rounded-xl border p-5 text-[12.5px]">
											No stored run to log yet.
										</p>
									)}
								</CurtainReveal>
							</div>
						</div>
					</section>
				</V7Page>

				{/* 9 — EVIDENCE + COUNTUP STATS */}
				<V7Page id="evidence">
					<section id="evidence" className="scroll-mt-20 py-24 sm:py-28">
						<div className={SECTION}>
							<SectionHead
								kicker="Evidence & gates"
								title="Nothing ships without proof"
								body="The evidence hub holds every claim with its source and status. The two D4 gates decide whether the answer is even allowed to reach the judge."
							/>
							{/* Owner ruling 2026-10-13: the frame around these four numbers read as a
							    box with a grid patch, so the strip carries no ornament and no hairline
							    at all — the numbers are separated by space, not by rules. */}
							<div className="mt-14 grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-4">
								{stats.map((s) => (
									<div key={s.label}>
										{/* V4 §4's slot-machine reels: the digits scroll past real digits, the leftmost
									    column stops first, and the caption only drifts up once the last reel lands. */}
										<SlotNumber
											to={s.to}
											suffix={s.suffix}
											label={s.label}
											className="font-display text-text text-[48px] leading-none font-bold tracking-[-0.04em] sm:text-[64px]"
										/>
									</div>
								))}
							</div>
						</div>
					</section>
				</V7Page>

				{/* 10 — MODELS & ROUTING */}
				<V7Page id="orchestra">
					<section className="relative py-24 sm:py-28">
						<div className={`${SECTION} relative z-10`}>
							<SectionHead
								kicker="Models & routing"
								title="Three families, one cheap floor, zero free tier"
								body="NanoGPT carries the traffic. Each family routes to its flagship; degradation walks down to a llama-3.3-70b floor and a policy fallback, cheaper and never free, because the provider has no free tier."
							/>
							<ModelRoutes rows={[...FAMILIES, FLOOR]} />
							<div className="mt-8 flex flex-wrap gap-2">
								{[
									'all-paid degradation (D-44)',
									'cost = tokens × curated per-1M rates (D-47)',
									'zero-citation knowledge mode (D-45)'
								].map((b) => (
									<span
										key={b}
										className="border-border text-text-faint rounded-full border px-3 py-1.5 font-mono text-[10.5px]"
									>
										{b}
									</span>
								))}
							</div>
						</div>
					</section>
				</V7Page>

				{/* 11 — ARCHITECTURE D1–D6 */}
				<V7Page id="routes">
					<section className="py-24 sm:py-28">
						<div className={SECTION}>
							<SectionHead kicker="Architecture" title="Six layers, each one drawn here" />
							<div className="mt-12">
								<ArchGrid />
							</div>
						</div>
					</section>
				</V7Page>

				{/* 12 — BENCHMARK (every figure read from the stored run) */}
				{/* V6 Job 4: this is the darkest section and it carries the page's measured
				    numbers, so karma's cable bundle goes behind it. §7's stacking: the bundle
				    is z-0 and the content wrapper below it is relative z-10. The chart's
				    bar-grow and the table's curtain are unchanged. */}
				<V7Page id="cable">
					<section id="benchmarks" className="relative scroll-mt-20 py-24 sm:py-28">
						<CableBundle />
						{/* V21: the two impacts land behind the numbers (z-5), and the content
						    wrapper below is the sibling that takes the thud. */}
						<RoutingStrike />
						<div className={`${SECTION} v21-thud relative z-10`}>
							<SectionHead
								kicker="Benchmarks"
								title={
									bench
										? `One full ${bench.taskCount}-task run. ${bench.rows.length} setups.`
										: 'No stored benchmark run yet'
								}
								karaoke
								body={
									bench && best && cheapest && fastest
										? `Judged by ${bench.judgeModel} against a rubric, priced from real token usage. Highest mean score: ${best.setup} at ${fmtScore(best.score)}. Lowest cost per task: ${fmtCost(cheapest.cost)} (${cheapest.setup}). Fastest: ${fmtLatency(fastest.latency)} (${fastest.setup}).`
										: 'The four-setup comparison has not been run against this database, so this section shows no numbers. It fills in from the first completed run stored here.'
								}
							/>
							{bench ? (
								<>
									<BenchChart rows={bench.rows} />
									{/* The table is the same measurement as the chart above it, so it gets
									    §5.4's curtain from the top down rather than a second grow animation
									    competing with the bars. */}
									<CurtainReveal direction="down" threshold={0.12}>
										<div className="border-border mt-6 overflow-x-auto rounded-xl border">
											<table className="w-full min-w-[560px] border-collapse text-left">
												<thead>
													<tr className="border-border">
														{[
															'Setup',
															'Avg score',
															'Avg cost / task',
															'Avg latency',
															'Success'
														].map((h) => (
															<th
																key={h}
																className="text-text-faint label-uppercase border-b border-[var(--border)] px-5 py-3"
															>
																{h}
															</th>
														))}
													</tr>
												</thead>
												<tbody className="font-mono text-[13px]">
													{bench.rows.map((r) => (
														<tr
															key={r.setup}
															className="border-group border-border hover:bg-surface border-b last:border-b-0"
														>
															<td className="text-text px-5 py-4 font-sans font-medium">
																{r.setup}
															</td>
															<td className="text-text-muted px-5 py-4">{fmtScore(r.score)}</td>
															<td className="text-text-muted px-5 py-4">{fmtCost(r.cost)}</td>
															<td className="text-text-muted px-5 py-4">{fmtLatency(r.latency)}</td>
															<td className="text-text-muted px-5 py-4">{r.pass}</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									</CurtainReveal>
									<p className="text-text-faint mt-5 text-[12.5px]">
										{`Whole-suite spend: ${fmtCost(bench.spendUsd)} · ${bench.taskCount} tasks x ${bench.rows.length} setups · results live on the dashboard.`}
									</p>
								</>
							) : (
								<p className="text-text-faint border-border mt-6 rounded-xl border p-5 text-[13px]">
									No completed four-setup benchmark run is stored here yet.
								</p>
							)}
						</div>
					</section>
				</V7Page>

				{/* 13 — FAQ */}
				<V7Page id="faq">
					<section id="faq" className="scroll-mt-20 py-24 sm:py-28">
						<div className={SECTION}>
							<SectionHead kicker="FAQ" title="Questions a juror would ask" />
							<div className="border-border mt-10 border-t">
								<Faq />
							</div>
						</div>
					</section>
				</V7Page>

				{/* 14 — CTA */}
				<V7Page id="cta">
					<section id="start" className="relative overflow-hidden py-32 sm:py-40">
						{/* V8 Job 4: the owner took the warm thermal blob out of this spot ("the animation
						    that is in color lite orange … is not according the theme") and asked for a
						    cursor-pushed glyph field in its place. It paints at z-0 under the mote field
						    and the content wrapper, and it adds nothing to the layout. */}
						<GlyphField className="pointer-events-none absolute inset-0" />
						<CursorField className="pointer-events-none absolute inset-0" />
						<div className="relative z-10 flex flex-col items-center px-6 text-center">
							{/* V4 §4's Gathering: the words leave from alternating edges, overshoot where
					    they collide, and the h2 keeps the CTA in the page's heading outline. */}
							<h2 className="font-display text-text max-w-[16ch] text-[40px] leading-[1.05] font-extrabold tracking-[-0.04em] text-balance sm:text-[72px]">
								<GatherWords text="Welcome to First Super AgentOS" />
							</h2>
							<FadeUp delay={260} y={16}>
								<div className="mt-10 flex flex-wrap items-center justify-center gap-3">
									{/* Magnetic approach pull, then the click ripple. Owner ruling for this run:
							    cards yes, buttons never — this button moves and sweeps, it gets no border
							    animation. */}
									<Magnetic radius={100}>
										<Button asChild className="energy" variant="primary" size="control">
											<Link href="/signup">
												<RippleLayer />
												Sign up
											</Link>
										</Button>
									</Magnetic>
									<Link
										href="/login"
										className="text-text-muted hover:text-text link-center ease-expo inline-flex min-h-11 items-center px-1 font-mono text-[13px] no-underline transition-colors duration-[var(--motion-base)]"
									>
										or log in
									</Link>
								</div>
							</FadeUp>
						</div>
					</section>
				</V7Page>

				{/* 15 — FOOTER */}
				<LandingFooter build={build} />
			</V7Camera>
		</main>
	)
}
