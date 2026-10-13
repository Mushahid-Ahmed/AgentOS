'use client'

// FAQ accordion (brief §6.2-13). Native <details>/<summary> so it is fully
// keyboard- and screen-reader-accessible with zero JS state; the marker and
// chevron motion is CSS-only and collapses under the global reduced-motion
// guard. Every answer below is a real product fact — no invented claims.
//
// V4 §4's "paper fold" is layered on the same native element, not a replacement
// for it: `::details-content` already transitions its own height, so the fold
// adds `rotateX` around the top edge, a clip-path that opens with it, and a
// crease shadow that lifts as the sheet flattens. All of it is CSS — no
// controller, no state, and the answer text is in the DOM whether the fold runs
// or not. A browser that knows neither `::details-content` nor `clip-path`
// transitions just opens the panel.
//
// The "+" is two bars rather than a glyph: the vertical one collapses on a
// spring, so the mark becomes a "−" instead of spinning into an "×".

const FAQS = [
	{
		q: 'How is the agent team chosen for each question?',
		a: 'Jev, the bounded decision engine, classifies the task, and the orchestra assembles the lineup for that run alone: typically a researcher, critics and a synthesizer, with model routes picked per agent. A trivial question gets a small team; an ambiguous one can earn more agents mid-run when the replan loop fires.'
	},
	{
		q: 'Which models does it actually use?',
		a: 'Three families routed through NanoGPT: claude (anthropic/claude-sonnet-4.5), gpt (openai/gpt-4.1) and gemini (gemini-2.5-flash), with a cheap llama-3.3-70b floor for degradation and gpt-4.1 as the benchmark judge. The Decision Bus records every choice as decided_by: jev or policy, so routing is auditable per run.'
	},
	{
		q: 'Is there a free tier?',
		a: 'No. The provider has no free tier, so the degradation chain is all-paid: it steps down to cheaper models rather than to free ones, and spend caps are enforced per run, day and month. The dashboard shows the cost of every call.'
	},
	{
		q: 'What happens when the evidence is thin?',
		a: 'Two Jev gates stand between a draft and an answer: enough evidence? and evidence valid? If either fails, the replan loop can spawn new agents, e.g. a second researcher and synthesizer, to close the gap before the judge sees the work.'
	},
	{
		q: 'Can I audit an answer after the fact?',
		a: 'Yes. Every claim lands in the evidence hub with its source and verification status, the final answer cites it, and any finished run replays deterministically from its event log: the same decisions, in the same order, at the same costs.'
	},
	{
		q: 'Where do the benchmark numbers come from?',
		a: 'They come from a completed 24-task run on this deployment comparing four setups. AgentOS scored higher than the simpler setups on the two tasks (doc-qa and deliberately ambiguous) its dynamic teams were built for, at a higher cost and latency than those setups.'
	},
	{
		q: 'What runs behind this product?',
		a: 'It is the product itself: the Decision Bus, MCP tools, evidence hub, gates and replay all run against a live Postgres (Supabase) database.'
	}
]

export function Faq() {
	return (
		<div className="w-full max-w-4xl">
			{FAQS.map((f, i) => (
				<details key={i} data-t2="faq" data-t4="fold" className="border-border group border-b">
					<summary className="text-text hover:text-accent group-open:text-accent ease-expo flex cursor-pointer list-none items-start justify-between gap-6 py-6 text-[16px] leading-[1.45] font-medium transition-colors duration-[var(--motion-base)] [&::-webkit-details-marker]:hidden">
						<span>{f.q}</span>
						<span
							aria-hidden
							className="text-text-faint group-open:text-accent relative mt-2.5 size-3.5 shrink-0 transition-colors duration-[var(--motion-base)]"
						>
							<span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-current" />
							{/* The spring lives on the collapsing bar only; the horizontal one
							    is the resting "−" the mark becomes. */}
							<span className="ease-spring absolute inset-y-0 left-1/2 w-px origin-center -translate-x-1/2 bg-current transition-transform duration-[var(--motion-slow)] group-open:scale-y-0" />
						</span>
					</summary>
					<p className="faq-answer text-text-muted relative max-w-[62ch] pb-6 text-[14px] leading-[1.65]">
						{f.a}
					</p>
				</details>
			))}
		</div>
	)
}
