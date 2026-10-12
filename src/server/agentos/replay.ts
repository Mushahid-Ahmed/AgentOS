import 'server-only'
import { db } from '@/server/db/client'
import type {
	ListRunsResponse,
	RunReplayResponse,
	RunSummary,
	RunViewWireEvent
} from '@/lib/agentos/replay'

// AgentOS run replay (M7 / §13). Rebuilds the exact wire-event list the live SSE
// stream produced, from the persisted agent_runs / decision_records / agent_events
// rows, so the client folds a replay through the SAME pure reducer as a live run.
//
// Two honesty rules drive the reconstruction:
//  1. Money/ids cross the wire as they are stored — BigInt id → string, cost kept as
//     integer millionths or null (never coerced to 0).
//  2. The EVIDENCE GRAPH counters must be accurate even for runs whose event log
//     predates the enriched evidence events, so each `evidence_added` frame is
//     hydrated from the authoritative evidence_records row (source, discovering
//     agent, FINAL verification status). This is reconstruction from the §13 source
//     of truth, not fabrication.

type AgentRunRow = {
	id: bigint
	createdAt: Date
	finishedAt: Date | null
	query: string
	status: string
	taskType: string
	tier: string
	executionMode: string
	costMicroUsd: bigint | null
	modelCalls: number
	toolCalls: number
	replans: number
	finalAnswer: string | null
	error: string | null
	eventCount: number
}

function toSummary(row: AgentRunRow): RunSummary {
	return {
		id: row.id.toString(),
		query: row.query,
		status: row.status,
		taskType: row.taskType,
		tier: row.tier,
		executionMode: row.executionMode,
		costMicroUsd: row.costMicroUsd != null ? Number(row.costMicroUsd) : null,
		modelCalls: row.modelCalls,
		toolCalls: row.toolCalls,
		replans: row.replans,
		hasFinalAnswer: typeof row.finalAnswer === 'string' && row.finalAnswer.trim().length > 0,
		error: row.error,
		createdAt: row.createdAt.toISOString(),
		finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
		eventCount: row.eventCount
	}
}

const RUN_SELECT = {
	id: true,
	createdAt: true,
	finishedAt: true,
	query: true,
	status: true,
	taskType: true,
	tier: true,
	executionMode: true,
	costMicroUsd: true,
	modelCalls: true,
	toolCalls: true,
	replans: true,
	finalAnswer: true,
	error: true,
	_count: { select: { events: true } }
} as const

function rowToSummary(row: {
	id: bigint
	createdAt: Date
	finishedAt: Date | null
	query: string
	status: string
	taskType: string
	tier: string
	executionMode: string
	costMicroUsd: bigint | null
	modelCalls: number
	toolCalls: number
	replans: number
	finalAnswer: string | null
	error: string | null
	_count: { events: number }
}): RunSummary {
	return toSummary({ ...row, eventCount: row._count.events })
}

/** The replay picker: recent runs, newest first. */
export async function listRuns(userId: string, limit = 50): Promise<ListRunsResponse> {
	const rows = await db.agentRun.findMany({
		// Ownership first. Without this predicate every signed-in user reads every other
		// user's run history; a NULL user_id (a run written before the column
		// existed) matches no uuid, so legacy runs are served to nobody.
		where: { userId },
		orderBy: { createdAt: 'desc' },
		take: Math.max(1, Math.min(100, limit)),
		select: RUN_SELECT
	})
	return { runs: rows.map(rowToSummary) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

// Pull the ordered team + per-agent model routing out of the persisted planning
// decisions, falling back to the stored plan DAG when a decision row is missing.
function reconstructTeam(
	decisions: ReadonlyArray<{ kind: string; output: unknown }>,
	plan: unknown
): { agents: string[]; modelByAgent: Record<string, string> } {
	const modelSelection = decisions.find((d) => d.kind === 'model_selection')
	const requiredAgents = decisions.find((d) => d.kind === 'required_agents')

	const modelByAgent: Record<string, string> = {}
	if (isRecord(modelSelection?.output)) {
		for (const [agent, model] of Object.entries(modelSelection.output)) {
			if (typeof model === 'string') modelByAgent[agent] = model
		}
	}

	let agents: string[] = []
	if (Array.isArray(requiredAgents?.output)) {
		agents = (requiredAgents?.output ?? []).filter((a): a is string => typeof a === 'string')
	}
	if (agents.length === 0 && isRecord(plan) && Array.isArray(plan.steps)) {
		const seen = new Set<string>()
		for (const step of plan.steps) {
			if (isRecord(step) && typeof step.agent === 'string' && !seen.has(step.agent)) {
				seen.add(step.agent)
				agents.push(step.agent)
			}
		}
	}
	return { agents, modelByAgent }
}

/**
 * Rebuild one run's wire-event stream for replay, or null when the id is unknown.
 * Events are merged by real timestamp: the `run` init is placed just before the
 * planning decisions, decisions use their persisted createdAt, and agent_events use
 * the Orchestra's own epoch-ms `at` (with `seq` as the tiebreaker so same-ms events
 * keep emission order). A gate decision therefore lands right before the replan it
 * triggered, exactly as it streamed live.
 */
export async function getRunReplay(userId: string, id: bigint): Promise<RunReplayResponse | null> {
	// One round trip for the whole page, not two. These four reads are independent by
	// row (all keyed by this run id), so awaiting the run lookup before starting the
	// other three put a full cross-region RTT in front of a replay that is entirely a
	// read. An unknown id returns null below; its three sibling queries match nothing
	// and come back empty, which is the cheaper way to answer a request that is a 404
	// anyway.
	const [run, decisions, events, evidence] = await Promise.all([
		db.agentRun.findFirst({ where: { id, userId }, select: { ...RUN_SELECT, plan: true } }),
		db.decisionRecord.findMany({ where: { runId: id }, orderBy: { id: 'asc' } }),
		db.agentEvent.findMany({ where: { runId: id }, orderBy: { seq: 'asc' } }),
		db.evidenceRecord.findMany({ where: { runId: id }, orderBy: { id: 'asc' } })
	])
	if (!run) return null

	// Authoritative evidence rows, keyed by the stringified BigInt id the executor
	// echoed as `evidenceId`, used to hydrate each evidence_added frame.
	const evidenceById = new Map<
		string,
		{ source: string | null; discoveredByAgent: string; status: string }
	>()
	for (const row of evidence) {
		evidenceById.set(row.id.toString(), {
			source: row.source,
			discoveredByAgent: row.discoveredByAgent,
			status: row.verificationStatus
		})
	}

	const runId = id.toString()
	const { agents, modelByAgent } = reconstructTeam(decisions, run.plan)

	type Timed = { key: number; order: number; sub: number; event: RunViewWireEvent }
	const timed: Timed[] = []

	// (0) The reconstructed init event, placed before the planning decisions.
	timed.push({
		key: run.createdAt.getTime() - 1000,
		order: 0,
		sub: 0,
		event: {
			name: 'run',
			data: {
				runId,
				taskType: run.taskType,
				tier: run.tier,
				executionMode: run.executionMode,
				agents,
				modelByAgent,
				// Deferred roles are a live-planning disclosure and are not persisted; a
				// completed replay has none to show.
				deferred: []
			}
		}
	})

	// (1) Decision records → `decision` frames (the streamed record shape).
	decisions.forEach((d, index) => {
		const at = d.createdAt.getTime()
		timed.push({
			key: at,
			order: 1,
			sub: index,
			event: {
				name: 'decision',
				data: {
					kind: d.kind,
					runId,
					inputSummary: d.inputSummary,
					output: d.output,
					decidedBy: d.decidedBy,
					confidence: d.confidence,
					latencyMs: d.latencyMs,
					at,
					rationale: d.rationale
				}
			}
		})
	})

	// (2) Agent events → their own frames, hydrating evidence_added from the hub.
	for (const e of events) {
		const payload = e.payload as unknown
		let data = payload
		if (e.type === 'evidence_added' && isRecord(payload)) {
			const row = evidenceById.get(String(payload.evidenceId ?? ''))
			if (row) {
				data = {
					...payload,
					source: row.source,
					discoveredByAgent: row.discoveredByAgent,
					status: row.status
				}
			}
		}
		// e.at is epoch ms as BigInt — well within double precision for current time.
		timed.push({ key: Number(e.at), order: 2, sub: e.seq, event: { name: e.type, data } })
	}

	timed.sort((a, b) => a.key - b.key || a.order - b.order || a.sub - b.sub)

	return {
		run: rowToSummary(run),
		events: timed.map((t) => t.event)
	}
}
