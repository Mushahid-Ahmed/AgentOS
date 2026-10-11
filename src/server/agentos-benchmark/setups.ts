import 'server-only'
import { env } from '@/lib/env'
import { getModel, costUsdFor } from '@/lib/models'
import { completeOnce, type ChatMessage, type NanoGPTCompletion } from '@/server/ai/nanogpt'
import { trackAiCall } from '@/server/lib/ai-usage/sink'
import { PROVIDER, TRACKED_MODEL } from '@/server/ai/tracked-models'
import { RESEARCH_TOOL } from '@/lib/mcp/research'
import { getToolRegistry } from '@/server/mcp/registry'
import { readResearchOutput } from '@/lib/agents/researcher-core'
import { OrchestraExecutor } from '@/lib/orchestra'
import { createMemoryEvidence } from '@/lib/evidence'
import type { BudgetLimits, Finalizer, Plan, PlanStep, Run } from '@/lib/orchestra/types'
import { AGENT_REGISTRY, MODEL_REGISTRY } from '@/server/agents'
import { agentRunStreamResponse } from '@/server/agentos/run'
import { parseRunFrame, splitFrames, type RunFrame } from '@/lib/agentos/sse'
import { deriveAgentosOutcome } from '@/lib/agentos-benchmark/derive'
import type { AgentosSetup, SetupTaskResult } from '@/lib/agentos-benchmark/stats'

// The four benchmark setups (milestone 8, AGENTOS_UPGRADE_PROMPT §14). Each runs the
// SAME task and returns a SetupTaskResult whose every figure is MEASURED here — real
// NanoGPT cost, real wall-clock latency, real model/tool-call counts, real evidence
// counts. Nothing is estimated or hard-coded (§ "do not invent numbers").
//
//   baseline_a — one gemini-2.5-flash call, no retrieval.
//   baseline_b — research-tool grounding (no-search mode per D-45), then one
//                gemini-2.5-flash call over it (RAG). With no live web backend the
//                "retrieval" is a general model's own knowledge, so B measures the
//                RAG scaffolding, not live-web grounding — an honest V3 limitation.
//   baseline_c — a FIXED researcher→critic→synthesizer DAG on the real Orchestra engine,
//                all gemini, in-memory evidence, NO Jev routing / gates / replan.
//   agentos    — the FULL production path, consumed in-process from agentRunStreamResponse
//                and folded through the SAME D6 reducer the UI uses (derive.ts), so the
//                benchmarked "AgentOS" is literally the shipped pipeline with zero drift.
//
// A/B use gemini-2.5-flash as the single generator; the rubric judge is gpt-4.1 (a
// different family), so no setup is graded by its own generator's family.

// The generator every non-AgentOS setup shares, so the ONLY thing that varies across
// A/B/C is the scaffolding around one model — a fair isolation of AgentOS's contribution.
const GENERATOR_LABEL = 'gemini' as const
const GENERATOR_MAX_TOKENS = 1024

// Non-critical bounds for the fixed baseline_c DAG (mirrors run.ts's caps, minus the
// replan loop, which baseline_c deliberately does not have). The cost cap is the real
// guard (§12); these bound a runaway plan.
const BASELINE_C_MAX_MODEL_CALLS = 12
const BASELINE_C_MAX_TOOL_CALLS = 12
const BASELINE_C_WALL_CLOCK_MS = 180_000
const STEP_TIMEOUT_MS = 60_000

export type BenchmarkTask = {
	id: string
	category: string
	task: string
	rubric: string
}

// Everything a runner measures except the identity + timing runSetup stamps on, so a
// runner can't forget a field and the dispatch owns latency uniformly.
type SetupOutcome = Omit<SetupTaskResult, 'taskId' | 'setup' | 'latencyMs'>

const ANSWERER_SYSTEM =
	'You are a helpful assistant. Answer the task directly and concisely. Use Markdown; put code in fenced blocks with a language. Do not invent facts — if you are unsure, say so.'

const RAG_SYSTEM =
	'You are a helpful assistant with access to retrieved research. Answer the task using ONLY the provided research plus your own clearly-marked general knowledge. Cite the source URLs inline where you rely on them. Do not invent facts or sources — if the research does not cover something, say it is unverified.'

function outcome(partial: Partial<SetupOutcome> & { ok: boolean }): SetupOutcome {
	return {
		ok: partial.ok,
		answer: partial.answer ?? null,
		error: partial.error ?? null,
		citations: partial.citations ?? 0,
		verifiedClaims: partial.verifiedClaims ?? 0,
		contestedClaims: partial.contestedClaims ?? 0,
		refutedClaims: partial.refutedClaims ?? 0,
		costMicroUsd: partial.costMicroUsd ?? 0,
		modelCalls: partial.modelCalls ?? 0,
		toolCalls: partial.toolCalls ?? 0,
		replans: partial.replans ?? 0
	}
}

function failure(error: string, costMicroUsd = 0, toolCalls = 0, modelCalls = 0): SetupOutcome {
	return outcome({ ok: false, error, costMicroUsd, toolCalls, modelCalls })
}

// Integer millionths of a USD for one completion, from the token counts NanoGPT
// reports × the curated per-1M price for the slug (costUsdFor, src/lib/models.ts).
// NanoGPT returns no monetary cost, so this IS the real measured spend. 0 when the
// slug is uncataloged or the call reported no tokens (a failed/empty completion).
function completionCostMicroUsd(slug: string, completion: NanoGPTCompletion): number {
	const usd = costUsdFor(slug, completion.usage?.prompt_tokens, completion.usage?.completion_tokens)
	return usd == null ? 0 : Math.round(usd * 1_000_000)
}

// One tracked gemini completion. Returns the trimmed text (empty string when the
// provider returned none — never fabricated) and its real cost in millionths USD.
async function geminiComplete(
	feature: string,
	system: string,
	user: string,
	meta: { setup: string; taskId: string }
): Promise<{ text: string; costMicroUsd: number }> {
	const slug = getModel(GENERATOR_LABEL).slug
	const messages: ChatMessage[] = [
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	]
	const completion = await trackAiCall(
		{
			provider: PROVIDER[GENERATOR_LABEL],
			model: TRACKED_MODEL[GENERATOR_LABEL],
			feature,
			// Ids/enums/numbers only (docs/rules/analytics.md rule 5).
			meta
		},
		() => completeOnce(slug, messages, GENERATOR_MAX_TOKENS)
	)
	return {
		text: completion.choices?.[0]?.message?.content?.trim() ?? '',
		costMicroUsd: completionCostMicroUsd(slug, completion)
	}
}

// ---- Setup A: single LLM, no retrieval ------------------------------------

async function baselineA(task: BenchmarkTask): Promise<SetupOutcome> {
	const { text, costMicroUsd } = await geminiComplete('agentos_bench_a', ANSWERER_SYSTEM, task.task, {
		setup: 'baseline_a',
		taskId: task.id
	})
	if (!text) return failure('empty_completion', costMicroUsd, 0, 1)
	return outcome({ ok: true, answer: text, costMicroUsd, modelCalls: 1 })
}

// ---- Setup B: single LLM + research-sonar RAG -----------------------------

async function baselineB(task: BenchmarkTask): Promise<SetupOutcome> {
	const registry = await getToolRegistry()
	const runId = `bench-b-${task.id}`
	const tool = await registry.call(RESEARCH_TOOL, { query: task.task, runId })
	// The research tool's real spend counts against setup B even when it fails, so the
	// cost figure is honest about what was attempted.
	const toolCost = tool.ok ? (tool.costMicroUsd ?? 0) : 0
	if (!tool.ok) return failure(`research_failed: ${tool.error}`, toolCost, 1)

	const { text: research, citations } = readResearchOutput(tool.output)
	const urls = citations.map((c) => c.url)
	const distinctUrls = new Set(urls).size
	const sourceBlock = urls.length > 0 ? `\n\nSources:\n${urls.map((u, i) => `[${i + 1}] ${u}`).join('\n')}` : ''
	const user = [
		`Task:\n${task.task}`,
		'',
		`Retrieved research:\n${research.trim() || '(the retrieval returned no content)'}${sourceBlock}`,
		'',
		'Answer the task using the research above.'
	].join('\n')

	const { text, costMicroUsd } = await geminiComplete('agentos_bench_b', RAG_SYSTEM, user, {
		setup: 'baseline_b',
		taskId: task.id
	})
	const totalCost = toolCost + costMicroUsd
	if (!text) return failure('empty_completion', totalCost, 1, 1)
	return outcome({ ok: true, answer: text, citations: distinctUrls, costMicroUsd: totalCost, modelCalls: 1, toolCalls: 1 })
}

// ---- Setup C: fixed multi-agent DAG on the real Orchestra engine ----------

// The lead (synthesizer) already produced the answer text as its step output, so
// finalization adds NO extra model call — extract that text. Mirrors run.ts's
// extractLeadText: the last succeeded step that produced prose wins.
function extractLeadText(run: Run): string {
	for (const step of [...run.plan.steps].reverse()) {
		const state = run.stepStates[step.id]
		const text = state?.result?.ok ? state.result.output?.text : undefined
		if (typeof text === 'string' && text.trim()) return text
	}
	return ''
}

// A FIXED team, identical for every task: researcher → critic → synthesizer, all on
// gemini, no Jev planning, no D4 gates, no D5 replan. This is the "static workflow"
// baseline AgentOS's adaptive routing is measured against. The DAG shape mirrors
// buildAgentPlan's tiers (critic depends on the primary worker; the lead depends on
// all workers and is critical) so the only difference from AgentOS is the adaptivity.
function fixedPlan(): Plan {
	const steps: PlanStep[] = [
		{
			id: 'researcher',
			agent: 'researcher',
			model: GENERATOR_LABEL,
			toolsAllowed: [RESEARCH_TOOL],
			inputs: {},
			dependsOn: [],
			critical: false
		},
		{
			id: 'critic',
			agent: 'critic',
			model: GENERATOR_LABEL,
			toolsAllowed: [],
			inputs: {},
			dependsOn: ['researcher'],
			critical: false
		},
		{
			id: 'synthesizer',
			agent: 'synthesizer',
			model: GENERATOR_LABEL,
			toolsAllowed: [],
			inputs: { workerIds: ['researcher', 'critic'] },
			dependsOn: ['researcher', 'critic'],
			critical: true
		}
	]
	return { steps }
}

async function baselineC(task: BenchmarkTask): Promise<SetupOutcome> {
	const evidence = createMemoryEvidence()
	const tools = await getToolRegistry()
	const runId = `bench-c-${task.id}`

	// Citations come from the REAL sources in the evidence hub, never invented —
	// a run with no evidence yields no citations (mirrors run.ts's finalizer).
	const finalizer: Finalizer = async (run) => {
		const answer = extractLeadText(run)
		const rows = await evidence.list()
		const seen = new Set<string>()
		const citations: string[] = []
		for (const row of rows) {
			if (row.source && !seen.has(row.source)) {
				seen.add(row.source)
				citations.push(row.source)
			}
		}
		return { answer, citations }
	}

	const limits: BudgetLimits = {
		maxCostMicroUsd: Math.round(env.PER_RUN_CAP_USD * 1_000_000),
		maxModelCalls: BASELINE_C_MAX_MODEL_CALLS,
		maxToolCalls: BASELINE_C_MAX_TOOL_CALLS,
		// No replan loop in the fixed baseline — that adaptivity is exactly what
		// baseline_c lacks and AgentOS provides.
		maxReplans: 0,
		maxWallClockMs: BASELINE_C_WALL_CLOCK_MS
	}

	const executor = new OrchestraExecutor(
		{ agents: AGENT_REGISTRY, models: MODEL_REGISTRY, tools },
		{ limits, evidence, finalizer, stepTimeoutMs: STEP_TIMEOUT_MS }
	)

	const run = await executor.execute(runId, task.task, fixedPlan())

	// Evidence counts read straight from the hub the critic verified against.
	const rows = await evidence.list()
	const sources = new Set<string>()
	let verified = 0
	let contested = 0
	let refuted = 0
	for (const row of rows) {
		if (row.source) sources.add(row.source)
		if (row.verificationStatus === 'verified') verified += 1
		else if (row.verificationStatus === 'contested') contested += 1
		else if (row.verificationStatus === 'refuted') refuted += 1
	}

	const answer = run.finalAnswer?.trim() ?? ''
	const ok = run.status === 'completed' && answer.length > 0
	return outcome({
		ok,
		answer: ok ? answer : null,
		error: ok ? null : (run.error ?? 'run did not complete'),
		citations: sources.size,
		verifiedClaims: verified,
		contestedClaims: contested,
		refutedClaims: refuted,
		costMicroUsd: run.usage.costMicroUsd,
		modelCalls: run.usage.modelCalls,
		toolCalls: run.usage.toolCalls,
		replans: run.usage.replans
	})
}

// ---- Setup D: the full AgentOS production path ----------------------------

// Consume the real SSE Response in-process: read the body stream, carve frames with
// the SAME tested splitFrames/parseRunFrame the client hook uses, and collect them.
// A frame that fails to parse is skipped (the wire is a boundary), never thrown on.
async function collectRunFrames(response: Response): Promise<RunFrame[]> {
	const body = response.body
	if (!body) return []
	const reader = body.getReader()
	const decoder = new TextDecoder()
	const frames: RunFrame[] = []
	let buffer = ''

	const absorb = (raw: string) => {
		const parsed = parseRunFrame(raw)
		if (parsed) frames.push(parsed)
	}

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })
			const { frames: complete, rest } = splitFrames(buffer)
			buffer = rest
			for (const raw of complete) absorb(raw)
		}
		// Flush a final frame that arrived without its trailing blank line.
		buffer += decoder.decode()
		if (buffer.trim().length > 0) {
			const { frames: tail } = splitFrames(`${buffer}\n\n`)
			for (const raw of tail) absorb(raw)
		}
	} finally {
		reader.releaseLock()
	}
	return frames
}

async function agentosSetup(task: BenchmarkTask): Promise<SetupOutcome> {
	// The real pipeline: its own Decision Bus planning, dynamic team, per-agent model
	// routing, MCP tools, RAG evidence hub, D4 gates and D5 replan. We only consume its
	// output stream and fold it through the D6 reducer, so setup-D metrics never drift
	// from what the UI shows for the same run.
	const response = agentRunStreamResponse(task.task)
	const frames = await collectRunFrames(response)
	const derived = deriveAgentosOutcome(frames)
	return outcome({
		ok: derived.ok,
		answer: derived.answer,
		error: derived.error,
		citations: derived.citations,
		verifiedClaims: derived.verifiedClaims,
		contestedClaims: derived.contestedClaims,
		refutedClaims: derived.refutedClaims,
		costMicroUsd: derived.costMicroUsd,
		modelCalls: derived.modelCalls,
		toolCalls: derived.toolCalls,
		replans: derived.replans
	})
}

const RUNNERS: Record<AgentosSetup, (task: BenchmarkTask) => Promise<SetupOutcome>> = {
	baseline_a: baselineA,
	baseline_b: baselineB,
	baseline_c: baselineC,
	agentos: agentosSetup
}

/**
 * Run one task under one setup, returning a fully-measured SetupTaskResult.
 *
 * Owns the wall-clock latency and the honest-failure contract: a throw from any
 * runner (a provider error, a tool failure, an unexpected crash) becomes a failed
 * row carrying the real reason and whatever cost was already incurred, never a
 * silent drop and never a fabricated answer (§8, §14).
 */
export async function runSetup(setup: AgentosSetup, task: BenchmarkTask): Promise<SetupTaskResult> {
	const startedAt = performance.now()
	try {
		const result = await RUNNERS[setup](task)
		return { ...result, taskId: task.id, setup, latencyMs: Math.round(performance.now() - startedAt) }
	} catch (error) {
		const latencyMs = Math.round(performance.now() - startedAt)
		const message = error instanceof Error ? error.message : 'setup_failed'
		return { ...failure(message), taskId: task.id, setup, latencyMs }
	}
}
