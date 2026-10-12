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

// The Prisma surface these writes go through: the app singleton by default, so a
// measurement script can pass its own client and exercise the real code path.
type Db = typeof db

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
 * One statement for the whole plan.
 *
 * The loop this replaces issued one `agentStep.upsert` per plan step, and every
 * statement to the pooler costs a full network round trip (measured: 20 trivial
 * sequential round trips = 37.8s from a client, ~4.6s from a us-east serverless
 * function against the ap-southeast-2 primary). A run saves after *every* state
 * change, so a 6-step plan was paying 6 round trips per save, many times over the
 * run's life — the dominant DB cost of a run by far, and nothing to do with query
 * plans (all these tables are tiny; EXPLAIN already shows Index Scan).
 *
 * Postgres does the same upsert for N rows in one `INSERT … ON CONFLICT`, which is
 * what this is. Values are bound parameters throughout (`Prisma.sql` placeholders,
 * never string interpolation), so the raw SQL cannot be injected.
 */
export async function upsertStepsBatch(
	client: Db,
	runId: bigint,
	steps: {
		key: string
		agent: string
		model: string
		toolsAllowed: unknown
		dependsOn: unknown
		status: string
		attempts: number
		startedAt: Date | null
		finishedAt: Date | null
		promptTokens: number
		completionTokens: number
		costMicroUsd: bigint | null
		outputSummary: string | null
		error: string | null
	}[]
): Promise<void> {
	if (steps.length === 0) return
	const values = steps.map((s) => {
		return Prisma.sql`(${runId}, ${s.key}, ${s.agent}, ${s.model}, ${JSON.stringify(s.toolsAllowed ?? null)}::jsonb, ${JSON.stringify(s.dependsOn ?? null)}::jsonb, ${s.status}, ${s.attempts}, ${s.startedAt}, ${s.finishedAt}, ${s.promptTokens}, ${s.completionTokens}, ${s.costMicroUsd}, ${s.outputSummary}, ${s.error})`
	})
	await client.$executeRaw(Prisma.sql`
		INSERT INTO "agent_steps"
			("run_id", "key", "agent", "model", "tools_allowed", "depends_on", "status", "attempts",
			 "started_at", "finished_at", "prompt_tokens", "completion_tokens", "cost_micro_usd",
			 "output_summary", "error")
		VALUES ${Prisma.join(values)}
		ON CONFLICT ("run_id", "key") DO UPDATE SET
			"agent" = EXCLUDED."agent",
			"model" = EXCLUDED."model",
			"tools_allowed" = EXCLUDED."tools_allowed",
			"depends_on" = EXCLUDED."depends_on",
			"status" = EXCLUDED."status",
			"attempts" = EXCLUDED."attempts",
			"started_at" = EXCLUDED."started_at",
			"finished_at" = EXCLUDED."finished_at",
			"prompt_tokens" = EXCLUDED."prompt_tokens",
			"completion_tokens" = EXCLUDED."completion_tokens",
			"cost_micro_usd" = EXCLUDED."cost_micro_usd",
			"output_summary" = EXCLUDED."output_summary",
			"error" = EXCLUDED."error"
	`)
}

/**
 * Build the per-run RunStore the executor persists through. One instance per run
 * (it owns the monotonic event `seq`). save() upserts the aggregate + every step;
 * appendEvent() writes one replay-log row. Both are best-effort — errors are
 * reported and swallowed, never propagated into the run.
 *
 * `client` defaults to the app's Prisma singleton and is only overridable so the
 * batch write can be exercised against a throwaway row in scripts/audit-db.mjs
 * without touching a real run.
 */
export function createRunStore(id: bigint, client: Db = db): RunStore {
	let seq = 0
	return {
		async save(run: Run): Promise<void> {
			try {
				await client.agentRun.update({
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
				// The plan's steps as one statement (see upsertStepsBatch). Deliberately
				// not wrapped in a transaction with the update above: BEGIN/COMMIT would
				// cost two more round trips to protect a write that is best-effort by
				// contract (the executor swallows store failures, and a half-saved run is
				// re-saved on the next state change).
				await upsertStepsBatch(
					client,
					id,
					run.plan.steps.map((step) => {
						const state = run.stepStates[step.id]
						const outputText = state?.result?.output?.text
						return {
							key: step.id,
							agent: step.agent,
							model: step.model,
							toolsAllowed: step.toolsAllowed,
							dependsOn: step.dependsOn,
							status: state?.status ?? 'pending',
							attempts: state?.attempts ?? 0,
							startedAt: state?.startedAt ? new Date(state.startedAt) : null,
							finishedAt: state?.finishedAt ? new Date(state.finishedAt) : null,
							promptTokens: state?.result?.tokens?.input ?? 0,
							completionTokens: state?.result?.tokens?.output ?? 0,
							costMicroUsd:
								state?.result?.costMicroUsd != null ? BigInt(state.result.costMicroUsd) : null,
							outputSummary:
								typeof outputText === 'string' ? outputText.slice(0, 4000) : null,
							error: state?.error ?? null
						}
					})
				)
			} catch (error) {
				captureError(error, { feature: 'agentos_run_save' })
			}
		},
		async appendEvent(_runId: string, event: OrchestrationEvent): Promise<void> {
			const s = seq++
			try {
				await client.agentEvent.create({
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
 *
 * Summed by Postgres, not in JS: the previous version fetched one row per run
 * since midnight and added them up client-side, so the gate that has to answer
 * before a run spends anything paid a row-per-run fetch to do it. `_sum` over a
 * nullable BigInt column ignores NULLs, which is the same rule, stated once in SQL.
 */
export async function nightlySpendMicroUsd(): Promise<bigint> {
	const midnight = new Date()
	midnight.setUTCHours(0, 0, 0, 0)
	const total = await db.agentRun.aggregate({
		_sum: { costMicroUsd: true },
		where: { createdAt: { gte: midnight } }
	})
	return total._sum.costMicroUsd ?? BigInt(0)
}

