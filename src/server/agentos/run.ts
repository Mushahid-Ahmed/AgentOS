import 'server-only'
import { env } from '@/lib/env'
import { log } from '@/server/lib/logger'
import { buildAgentPlan, createVerificationReplanPolicy, shouldRunGates } from '@/lib/agents'
import { OrchestraExecutor } from '@/lib/orchestra'
import type { EvidencePort } from '@/lib/evidence'
import type { BudgetLimits, Finalizer, OrchestrationEvent, Plan, Run } from '@/lib/orchestra/types'
import { createDecisionBus } from '@/server/ai/decision-bus'
import { AGENT_REGISTRY, MODEL_REGISTRY, REGISTERED_ROLES } from '@/server/agents'
import { getToolRegistry } from '@/server/mcp/registry'
import {
	createAgentRun,
	createRunStore,
	markRunFailed,
	nightlySpendMicroUsd,
	persistDecision,
	setPlan
} from './store'
import { createEvidenceStore } from './evidence-store'

// The AgentOS run pipeline (§10 D1 flow, simplest path for M3): the Decision Bus
// plans the run (one batched Jev call -> task type, complexity, team, per-agent
// model routing), the plan builder turns that into a DAG, and the Orchestra
// executor runs it on real models while every typed event streams to the client
// as SSE and persists for replay. This module owns the orchestration; the route
// file (src/app/api/agentos/route.ts) is a thin transport adapter, per the
// template's "route.ts = zero logic" rule. Streaming routes are the documented
// exception to createApiRoute (which buffers JSON).
//
// Budget is enforced in code (§12): the per-run cap becomes the executor's
// max_cost, and the nightly cap is checked BEFORE any spend so an exhausted night
// refuses new runs honestly instead of silently overspending.

// Non-critical caps. The cost cap is the real guard (§12); these bound a runaway
// plan. Generous enough for the M4/M5 multi-agent teams, tight enough to stop a
// loop. Wall clock is high because localhost has no serverless time limit (§4).
const MAX_MODEL_CALLS = 12
const MAX_TOOL_CALLS = 12
const MAX_REPLANS = 2
const MAX_WALL_CLOCK_MS = 180_000
// A real NanoGPT completion (up to 1024 tokens) can take longer than the
// core's 30s default, and a spurious step timeout triggers a retry — i.e. extra
// spend for a call that was merely slow. 60s gives a slow model room without
// letting a genuinely hung call stall the run.
const STEP_TIMEOUT_MS = 60_000

function encodeEvent(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function budgetLimits(): BudgetLimits {
	return {
		maxCostMicroUsd: Math.round(env.PER_RUN_CAP_USD * 1_000_000),
		maxModelCalls: MAX_MODEL_CALLS,
		maxToolCalls: MAX_TOOL_CALLS,
		maxReplans: MAX_REPLANS,
		maxWallClockMs: MAX_WALL_CLOCK_MS
	}
}

// The lead agent (synthesizer/answerer) already generated the answer text as its step
// output, so finalization adds NO extra model call — it extracts that text. The last
// succeeded step that produced prose wins (the lead runs last, so it is normally the
// lead). An honest fallback, never a fabricated answer, when nothing produced text.
function extractLeadText(run: Run): string {
	for (const step of [...run.plan.steps].reverse()) {
		const state = run.stepStates[step.id]
		const text = state?.result?.ok ? state.result.output?.text : undefined
		if (typeof text === 'string' && text.trim()) return text
	}
	return 'The run finished but no agent produced an answer. This is reported honestly rather than filled in.'
}

// The M5 finalizer: attach the REAL source URLs recorded in the evidence hub, so the
// `final` event carries the citations the researcher actually retrieved (§13) rather
// than an empty list. Distinct sources in evidence order, never invented — a run with
// no evidence simply yields no citations.
function createEvidenceFinalizer(evidence: EvidencePort): Finalizer {
	return async (run: Run) => {
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
}

/**
 * Build the streaming SSE Response for one AgentOS run.
 *
 * Emits, in order: `run` (id + any deferred roles) -> `decision`* (the planning
 * records) -> the executor's typed events (run_started, plan_created, status,
 * model_selected, agent_started, agent_finished, cost_update, final | error).
 * Never rejects: an upstream failure becomes a terminal `error` event so the
 * client always gets a clean end-of-stream.
 */
export function agentRunStreamResponse(query: string, userId: string | null): Response {
	// Hoisted out of start() so the cancel() handler (client disconnect) can mark
	// the run terminal too. Null until createAgentRun returns the row id.
	let runRowId: bigint | null = null
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder()
			// Set the moment an enqueue fails: the consumer socket is closed, i.e. the
			// client disconnected. Runtime-independent (Node throws a TypeError here, not
			// a DOMException, so classifying by error.name is unreliable).
			let clientGone = false
			const send = (event: string, data: unknown) => {
				try {
					controller.enqueue(encoder.encode(encodeEvent(event, data)))
				} catch (err) {
					clientGone = true
					throw err
				}
			}

			try {
				// Nightly cap gate (§12): refuse a NEW run once tonight's real spend
				// has reached the cap. Checked before any paid call.
				const nightlyCapMicro = BigInt(Math.round(env.NIGHTLY_SPEND_CAP_USD * 1_000_000))
				const spentTonight = await nightlySpendMicroUsd()
				if (spentTonight >= nightlyCapMicro) {
					send('error', {
						message: `Nightly spend cap reached (${env.NIGHTLY_SPEND_CAP_USD} USD). No new runs until it resets.`,
						code: 'nightly_cap'
					})
					controller.close()
					return
				}

				const id = await createAgentRun(query, userId)
				runRowId = id
				const runId = id.toString()

				// Plan via the Decision Bus. Each record is persisted (best-effort) by
				// the sink AND streamed to the client so the D6 decision panel can show
				// what Jev decided vs what fell back to policy.
				const bus = createDecisionBus({ record: (record) => persistDecision(record) })
				const decision = await bus.planRun({ runId, query })

				const { plan, deferred } = buildAgentPlan({ decision, registered: REGISTERED_ROLES })
				await setPlan(id, decision, plan)

				send('run', {
					runId,
					taskType: decision.taskType,
					tier: decision.complexityTier,
					executionMode: decision.executionMode,
					agents: decision.agents,
					modelByAgent: decision.modelByAgent,
					// Roles Jev selected that M3 hasn't implemented yet — disclosed, not
					// silently dropped. Empty on the simple path.
					deferred
				})
				for (const record of decision.records) {
					send('decision', record)
				}

				if (plan.steps.length === 0) {
					// No registered agent could serve the team — an honest failure, not a
					// silent empty answer. Persist the terminal status too, else the row
					// is orphaned in `planning` with no error.
					const message = `No executable agent for the selected team (${decision.agents.join(', ')}).`
					await markRunFailed(id, `empty_plan: ${message}`)
					send('error', { message, code: 'empty_plan' })
					controller.close()
					return
				}

				const store = createRunStore(id)
				// The per-run evidence hub, shared by the executor (which wraps it so agent
				// writes emit evidence_added/contradiction_found) and the finalizer (which
				// reads it back for real citations). One store instance, one run id.
				const evidence = createEvidenceStore(id)
				// §12 escalation: the D4 verification gates + D5 replan loop only fire at the
				// hard tiers. A research delta grants RESEARCH_TOOL, so the MCP registry must
				// be connected whenever gates are enabled even if the ORIGINAL plan had no
				// tool — otherwise validatePlan would reject the delta for a missing tool.
				const gatesEnabled = shouldRunGates(decision.complexityTier)
				// Connect the MCP tool registry only when the plan actually grants a
				// tool. validatePlan rejects a step whose toolsAllowed names a tool the
				// registry lacks, so a `code` step (calculator) or a `researcher` step
				// (research tool) requires a real registry; a tool-free run (e.g. the
				// simple answerer path) never spins up the pair.
				const needsTools = gatesEnabled || plan.steps.some((s) => s.toolsAllowed.length > 0)
				const tools = needsTools ? await getToolRegistry() : undefined
				// The lead model Jev routed, carried forward to any re-synthesizer delta step.
				const lead = decision.agents[decision.agents.length - 1]
				const leadModel = lead ? decision.modelByAgent[lead] : undefined
				// The M6 verification replan policy: the same bus that planned the run now
				// drives the D4 gates. Each gate record is streamed to the client as it is
				// made (the bus's own sink already persists it, so onDecision only sends).
				const replanPolicy = gatesEnabled
					? createVerificationReplanPolicy({
							gates: bus,
							evidence,
							runId,
							query,
							complexityTier: decision.complexityTier,
							leadModel,
							onDecision: (record) => send('decision', record)
						})
					: undefined
				const executor = new OrchestraExecutor(
					{ agents: AGENT_REGISTRY, models: MODEL_REGISTRY, tools },
					{
						limits: budgetLimits(),
						store,
						evidence,
						replanPolicy,
						finalizer: createEvidenceFinalizer(evidence),
						stepTimeoutMs: STEP_TIMEOUT_MS
					}
				)

				// Pipe every typed orchestration event to the SSE stream. The event
				// `type` is the SSE event name and the whole event is the payload, so the
				// client and the persisted replay log see one identical protocol (§13).
				executor.subscribe((event: OrchestrationEvent) => {
					send(event.type, event)
				})

				await executor.execute(runId, query, plan as Plan)
				controller.close()
			} catch (error) {
				log.error('agentos run failed', { error, clientGone })
				const message = error instanceof Error ? error.message : 'Unexpected server error.'
				// If an enqueue already failed, the client is gone — record that honestly
				// rather than the raw "Controller is already closed" TypeError text, which
				// reads like a server bug in the run view. A genuine error keeps its message.
				const reason = clientGone ? 'client_disconnected' : message
				if (!clientGone) {
					try {
						send('error', { message: reason, code: 'internal' })
					} catch {
						// controller closed mid-send; nothing left to deliver
					}
				}
				// Don't leave the row orphaned in a non-terminal status. No-op if
				// createAgentRun never returned an id, or the executor already finished.
				if (runRowId !== null) await markRunFailed(runRowId, reason)
				try {
					controller.close()
				} catch {
					// already closed on the disconnect path
				}
			}
		},
		// Fires when the consumer (HTTP client) disconnects. The executor may still
		// be running server-side (no AbortSignal is threaded through in M3 — the
		// wall-clock budget bounds it); markRunFailed's non-terminal filter means we
		// only claim the row if the executor hasn't already driven it to a terminal
		// state, so a run that completes anyway is never clobbered.
		async cancel(reason) {
			if (runRowId !== null) {
				await markRunFailed(runRowId, `client_disconnected${reason ? `: ${String(reason)}` : ''}`)
			}
		}
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			// Stop proxies from buffering the stream.
			'X-Accel-Buffering': 'no'
		}
	})
}
