import { db } from '@/server/db/client'
import { env } from '@/lib/env'
import type { TypeSeg } from '@/components/motion/typewriter'
import type { LandingBuild } from '@/components/landing/landing-footer'
import {
	AGENTOS_BENCHMARK_SETUPS,
	SETUP_LABELS,
	buildAgentosBenchmarkReport,
	formatRate
} from '@/lib/agentos-benchmark/stats'
import type { AgentosSetup, JudgeVerdict, SetupTaskResult } from '@/lib/agentos-benchmark/stats'

// The landing's two data surfaces (the four-setup benchmark table and the Decision Bus
// terminal) are READ, not written into the page: V14 M2 removed the literals they used
// to carry, so every figure a visitor sees is recomputed from stored rows by the same
// pure stats module the dashboard uses.
//
// Public scope rule (V14): this reader may only surface runs with `userId IS NULL`, the
// pre-ownership benchmark and agent runs that have no account behind them. A run a user
// launched is never rendered on an anonymous marketing page, even as an aggregate — the
// per-user rule the dashboard enforces would be meaningless if the landing published it.
// When a database holds no ownerless run, the reader returns null and the page says so
// instead of showing a number.

const MICROS_PER_USD = 1_000_000

export type LandingBenchRow = {
	setup: string
	score: number
	cost: number
	latency: number
	pass: string
}

export type LandingBench = {
	rows: LandingBenchRow[]
	taskCount: number
	// Sum of every setup's measured spend plus the judge's own routing spend.
	spendUsd: number
	judgeModel: string
}

export type LandingPreview = {
	bench: LandingBench | null
	bus: TypeSeg[][] | null
	build: LandingBuild
}

type Rec = Record<string, unknown>

const asRec = (v: unknown): Rec | null =>
	typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null
const asStr = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

// Newest completed, non-pilot benchmark run with no owner, aggregated through the pure
// stats module so the landing cannot drift from the dashboard's reading of the same rows.
async function readBench(): Promise<LandingBench | null> {
	const run = await db.agentosBenchmarkRun.findFirst({
		where: { userId: null, status: 'completed', pilot: false },
		orderBy: { startedAt: 'desc' },
		include: { results: true, verdicts: true }
	})
	if (!run) return null

	const results: SetupTaskResult[] = run.results.map((row) => ({
		taskId: row.taskId,
		setup: row.setup as AgentosSetup,
		ok: row.ok,
		answer: row.answer,
		error: row.error,
		citations: row.citations,
		verifiedClaims: row.verifiedClaims,
		contestedClaims: row.contestedClaims,
		refutedClaims: row.refutedClaims,
		costMicroUsd: row.costMicroUsd == null ? 0 : Number(row.costMicroUsd),
		latencyMs: row.latencyMs,
		modelCalls: row.modelCalls,
		toolCalls: row.toolCalls,
		replans: row.replans
	}))
	const verdicts: JudgeVerdict[] = run.verdicts.map((row) => ({
		taskId: row.taskId,
		setup: row.setup as AgentosSetup,
		score: row.score,
		unsupportedClaims: row.unsupportedClaims,
		notes: row.notes ?? '',
		judgeModel: row.judgeModel
	}))

	const report = buildAgentosBenchmarkReport(
		{
			runId: run.id.toString(),
			label: run.label,
			judgeModel: run.judgeModel,
			generatorModel: run.generatorModel,
			startedAt: run.startedAt.toISOString(),
			// A run with no finishedAt stamp falls back to its start, as the dashboard
			// report does.
			finishedAt: (run.finishedAt ?? run.startedAt).toISOString(),
			taskCount: run.taskCount
		},
		results,
		verdicts
	)

	// A setup the chart can draw needs a measured score, cost and latency; a setup with
	// none of that (all tasks failed, nothing judged) is absent rather than zero-filled.
	const rows = AGENTOS_BENCHMARK_SETUPS.map((setup) => report.setups.find((s) => s.setup === setup))
		.filter(
			(s): s is NonNullable<typeof s> =>
				s != null &&
				s.attempted > 0 &&
				s.meanJudgeScore != null &&
				s.meanCostMicroUsd != null &&
				s.meanLatencyMs != null
		)
		.map((s) => ({
			setup: SETUP_LABELS[s.setup],
			score: s.meanJudgeScore as number,
			cost: (s.meanCostMicroUsd as number) / MICROS_PER_USD,
			latency: (s.meanLatencyMs as number) / 1000,
			pass: formatRate(s.successRate)
		}))
	if (rows.length === 0) return null

	const spendMicro =
		results.reduce((acc, r) => acc + r.costMicroUsd, 0) +
		(run.judgeCostMicroUsd == null ? 0 : Number(run.judgeCostMicroUsd))

	return {
		rows,
		taskCount: run.taskCount,
		spendUsd: spendMicro / MICROS_PER_USD,
		judgeModel: run.judgeModel
	}
}

// The Decision Bus log: the last ownerless run that finished, rendered from its stored
// event rows. Only decision metadata goes on screen — agent names, model routes, added
// steps, evidence counters, answer length and spend. The query and the answer text belong
// to that run and stay in the database.
async function readBus(): Promise<TypeSeg[][] | null> {
	const run = await db.agentRun.findFirst({
		where: { userId: null, status: 'completed', finalAnswer: { not: null } },
		orderBy: { startedAt: 'desc' },
		select: { id: true, costMicroUsd: true, finalAnswer: true }
	})
	if (!run) return null

	const events = await db.agentEvent.findMany({
		where: { runId: run.id },
		orderBy: { seq: 'asc' },
		select: { type: true, payload: true }
	})
	if (events.length === 0) return null

	const lines: TypeSeg[][] = [[{ t: `$ tail -f run-${run.id}.events`, tone: 'dim' }]]

	// team.assemble — the roster the planner put on this task.
	const plan = asRec(events.find((e) => e.type === 'plan_created')?.payload)?.plan
	const steps = asArr(asRec(plan)?.steps)
	const roster = [
		...new Set(steps.map((s) => asStr(asRec(s)?.agent)).filter((a): a is string => a !== null))
	]
	if (roster.length > 0) {
		lines.push([{ t: '  team.assemble  ' }, { t: roster.join(' · '), tone: 'text' }])
	}

	// routes — the per-step model choices the router actually made.
	const routes = new Map<string, string>()
	for (const e of events) {
		if (e.type !== 'model_selected') continue
		const p = asRec(e.payload)
		const stepId = asStr(p?.stepId)
		const model = asStr(p?.model)
		if (stepId && model) routes.set(stepId, model)
	}
	const routeText = [...routes].map(([step, model]) => `${step}→${model}`).join(' · ')
	if (routeText) {
		lines.push([{ t: '  routes         ' }, { t: routeText, tone: 'text' }])
	}

	// d4.gate → d5.replan — the Jev gate outcome and the steps D5 added, with their models.
	const replan = asRec(events.find((e) => e.type === 'replan')?.payload)
	if (replan) {
		const reason = asStr(replan.reason) ?? ''
		const gate = reason.split(':')[0]?.trim()
		if (gate) lines.push([{ t: `  d4.gate ${gate}`, tone: 'accent' }])
		const added = asArr(replan.addedSteps).filter((s): s is string => typeof s === 'string')
		if (added.length > 0) {
			const seg: TypeSeg[] = [{ t: '  d5.replan      ' }]
			for (const step of added) {
				seg.push({ t: ` + ${step} `, tone: 'text' })
				const model = routes.get(step)
				if (model) seg.push({ t: `(${model})`, tone: 'accent' })
			}
			lines.push(seg)
		}
	} else {
		lines.push([{ t: '  d4.gate passed', tone: 'accent' }])
	}

	// evidence — what the hub recorded, counted from the events that recorded it.
	const addedCount = events.filter((e) => e.type === 'evidence_added').length
	const checkedCount = events.filter((e) => e.type === 'evidence_verified').length
	if (addedCount > 0 || checkedCount > 0) {
		lines.push([
			{ t: '  evidence       ' },
			{ t: `${addedCount} added · ${checkedCount} checked`, tone: 'text' }
		])
	}

	// answer — length and measured spend of the run; the text itself is not published.
	const chars = (run.finalAnswer ?? '').length
	const usd = run.costMicroUsd == null ? null : Number(run.costMicroUsd) / MICROS_PER_USD
	lines.push([
		{ t: '  answer         ' },
		{
			t: `${chars.toLocaleString('en-US')} chars${usd == null ? '' : ` · $${usd.toFixed(6)}`}`,
			tone: 'text'
		}
	])

	return lines
}

// What the deployment actually is, read from the config it boots with. V14 M2 deleted the
// footer's typed-in build line, which claimed a development build and a localhost deployment
// even while serving production.
function readBuild(): LandingBuild {
	const databaseHost = (() => {
		try {
			return new URL(env.DATABASE_URL).hostname
		} catch {
			return ''
		}
	})()
	return {
		environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
		provider: env.NANOGPT_API_KEY ? 'NanoGPT' : null,
		database: databaseHost
			? databaseHost.includes('supabase')
				? 'Supabase Postgres'
				: databaseHost
			: null
	}
}

export async function readLandingPreview(): Promise<LandingPreview> {
	// The landing must still render (and still be honest) if the read fails, so a DB error
	// degrades to the empty state rather than to a 500 on the marketing page.
	const [bench, bus] = await Promise.all([
		readBench().catch(() => null),
		readBus().catch(() => null)
	])
	return { bench, bus, build: readBuild() }
}
