import 'server-only'
import { db, Prisma } from '@/server/db/client'
import { captureError } from '@/lib/observability/capture-error'
import type { DecisionRecord } from '@/lib/decisions'
import type { OrchestrationEvent, Run, RunStore } from '@/lib/orchestra/types'
import type { PlanDecision } from '@/lib/decisions/types'

// AgentOS persistence (§10.1: persisted after every state change, for crash
// recovery and UI replay). Split out of the run orchestrator so the streaming
// logic stays readable, and best-effort by design: a DB failure costs a saved
// run, never the user's answer — the executor already swallows store errors, and
// the helpers here report their own to Sentry.
//
// Ids are BigInt in the DB and cross the wire as strings (JSON has no BigInt);
// the Orchestra run id IS the AgentRun BigInt id stringified, so BigInt(runId)
// round-trips exactly.

type Json = Prisma.InputJsonValue

// Create the run row up front so it has a BigInt id to plan against (the Decision
// Bus records decisions by run id, and the executor echoes it on every event).
// The planning columns start as placeholders and are filled by setPlan once the
// Decision Bus has decided.
export async function createAgentRun(query: string): Promise<bigint> {
	const run = await db.agentRun.create({
		data: {
			query,
			status: 'planning',
			taskType: 'pending',
			tier: 'pending',
			executionMode: 'pending',
			plan: { steps: [] } satisfies Json
		},
		select: { id: true }
	})
	return run.id
}

// Write the planning decision onto the run row once the Decision Bus returns.
export async function setPlan(id: bigint, decision: PlanDecision, plan: unknown): Promise<void> {
	await db.agentRun.update({
		where: { id },
		data: {
			taskType: decision.taskType,
			tier: decision.complexityTier,
			executionMode: decision.executionMode,
			plan: plan as Json
		}
	})
}

// Statuses the Orchestra can still move forward from. Anything else (completed |
// failed | budget_stopped) is terminal and must never be overwritten.
const NON_TERMINAL_STATUSES = ['planning', 'running', 'verifying', 'replanning', 'finalizing']

/**
 * Best-effort terminal marker for a run that will NOT reach a terminal state on
 * its own: the client disconnected, the empty-plan early return fired, or
 * something threw before the executor took over ownership of the status. Without
 * it such a row is orphaned in `planning` with `error = NULL` forever — a silent
 * non-completion (§8/§11 forbid it) that the M7 run view would show as eternally
 * in-flight.
 *
 * Atomic and idempotent: `updateMany` with a non-terminal status filter means it
 * never clobbers a run the executor already drove to completed/failed/
 * budget_stopped, and the catch block + stream-cancel handler can both call it
 * for the same run without racing.
 */
export async function markRunFailed(id: bigint, error: string): Promise<void> {
	try {
		await db.agentRun.updateMany({
			where: { id, status: { in: NON_TERMINAL_STATUSES } },
			data: { status: 'failed', error, finishedAt: new Date() }
		})
	} catch (err) {
		captureError(err, { feature: 'agentos_mark_failed' })
	}
}

// Persist one Decision Bus record. Best-effort: a failure is reported and
// swallowed so a decision is never lost from the run because its row failed.
export async function persistDecision(record: DecisionRecord): Promise<void> {
	try {
		await db.decisionRecord.create({
			data: {
				runId: BigInt(record.runId),
				kind: record.kind,
				inputSummary: record.inputSummary,
				output: record.output as Json,
				decidedBy: record.decidedBy,
				confidence: record.confidence,
				latencyMs: record.latencyMs,
				rationale: record.rationale
			}
		})
	} catch (error) {
		captureError(error, { feature: 'agentos_decision_persist', kind: record.kind })
	}
}

/**
 * Build the per-run RunStore the executor persists through. One instance per run
 * (it owns the monotonic event `seq`). save() upserts the aggregate + every step;
 * appendEvent() writes one replay-log row. Both are best-effort — errors are
 * reported and swallowed, never propagated into the run.
 */
export function createRunStore(id: bigint): RunStore {
	let seq = 0
	return {
		async save(run: Run): Promise<void> {
			try {
				await db.agentRun.update({
					where: { id },
					data: {
						status: run.status,
						costMicroUsd: run.usage.costMicroUsd > 0 ? BigInt(run.usage.costMicroUsd) : null,
						modelCalls: run.usage.modelCalls,
						toolCalls: run.usage.toolCalls,
						replans: run.usage.replans,
						finalAnswer: run.finalAnswer,
						error: run.error,
						finishedAt: run.finishedAt ? new Date(run.finishedAt) : null
					}
				})
				for (const step of run.plan.steps) {
					const state = run.stepStates[step.id]
					const startedAt = state?.startedAt ? new Date(state.startedAt) : null
					const finishedAt = state?.finishedAt ? new Date(state.finishedAt) : null
					const outputText = state?.result?.output?.text
					await db.agentStep.upsert({
						where: { runId_key: { runId: id, key: step.id } },
						create: {
							runId: id,
							key: step.id,
							agent: step.agent,
							model: step.model,
							toolsAllowed: step.toolsAllowed as unknown as Json,
							dependsOn: step.dependsOn as unknown as Json,
							status: state?.status ?? 'pending',
							attempts: state?.attempts ?? 0,
							startedAt,
							finishedAt,
							promptTokens: state?.result?.tokens?.input ?? 0,
							completionTokens: state?.result?.tokens?.output ?? 0,
							costMicroUsd:
								state?.result?.costMicroUsd != null ? BigInt(state.result.costMicroUsd) : null,
							outputSummary: typeof outputText === 'string' ? outputText.slice(0, 4000) : null,
							error: state?.error ?? null
						},
						update: {
							status: state?.status ?? 'pending',
							attempts: state?.attempts ?? 0,
							startedAt,
							finishedAt,
							promptTokens: state?.result?.tokens?.input ?? 0,
							completionTokens: state?.result?.tokens?.output ?? 0,
							costMicroUsd:
								state?.result?.costMicroUsd != null ? BigInt(state.result.costMicroUsd) : null,
							outputSummary: typeof outputText === 'string' ? outputText.slice(0, 4000) : null,
							error: state?.error ?? null
						}
					})
				}
			} catch (error) {
				captureError(error, { feature: 'agentos_run_save' })
			}
		},
		async appendEvent(_runId: string, event: OrchestrationEvent): Promise<void> {
			const s = seq++
			try {
				await db.agentEvent.create({
					data: {
						runId: id,
						seq: s,
						type: event.type,
						payload: event as unknown as Json,
						at: BigInt(event.at)
					}
				})
			} catch (error) {
				captureError(error, { feature: 'agentos_event_persist', type: event.type })
			}
		}
	}
}

/**
 * Real spend so far tonight (UTC), in integer millionths of a USD — the sum of
 * every AgentRun's cost_micro_usd since midnight. Used to gate a new run against
 * NIGHTLY_SPEND_CAP_USD (§12) before it spends anything. NULL costs are skipped
 * (never counted as 0), matching the "never fabricate a number" rule.
 */
export async function nightlySpendMicroUsd(): Promise<bigint> {
	const midnight = new Date()
	midnight.setUTCHours(0, 0, 0, 0)
	const rows = await db.agentRun.findMany({
		where: { createdAt: { gte: midnight } },
		select: { costMicroUsd: true }
	})
	let total = BigInt(0)
	for (const row of rows) {
		// NULL cost (nothing priced) is skipped, never counted as 0 — matching the
		// ai_usage / route_events "money is NULL, never 0" rule.
		if (row.costMicroUsd != null) total += row.costMicroUsd
	}
	return total
}
