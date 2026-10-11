import { BudgetGuard, type Clock } from './budget'
import { EventBus, type EventSubscriber } from './events'
import { validatePlan } from './plan'
import { createMemoryEvidence, type EvidencePort } from '@/lib/evidence'
import type {
	AgentContext,
	AgentRegistry,
	Finalizer,
	ModelRegistry,
	OrchestrationEvent,
	Plan,
	PlanDelta,
	PlanStep,
	ReplanPolicy,
	Run,
	RunStatus,
	RunStore,
	StepResult,
	StepState,
	ToolRegistry,
	ToolResult
} from './types'

// The Orchestra executor (§10). A small, typed, observable workflow engine that
// runs a Plan (a DAG) with injected agents/models/tools, an injected budget
// guard, and an injected replan policy. It is deliberately free of any real I/O:
// persistence, model calls, tools, the clock, and backoff sleeps are all passed
// in, so the whole engine is exercised with MOCKED agents under `node --test`
// before a single real model is wired (§10 closing line).
//
// Lifecycle per §10.3: steps run in dependency LEVELS (independent steps in a
// level run in parallel, levels run sequentially); each step goes
// pending -> running -> succeeded | failed | skipped with retries and a timeout.
// A failed non-critical step does not kill the run; a failed critical step
// triggers the replan loop or an honest failure (§10.5). After work steps settle,
// the injected replan policy decides whether to add steps (D4/D5, §10.6), bounded
// by maxReplans. Every state change emits a typed event and persists the run.

export type ExecutorRegistries = {
	agents: AgentRegistry
	models: ModelRegistry
	tools?: ToolRegistry
}

export type ExecutorOptions = {
	limits: import('./types').BudgetLimits
	// Per-step wall timeout. On exceed the step's promise is abandoned and the
	// attempt counts as a retryable failure.
	stepTimeoutMs?: number
	// Bounded retries for transient (thrown/timeout/retryable) failures.
	maxRetries?: number
	// Base for exponential backoff between retries; the sleeper is injected so
	// tests never really wait.
	retryBackoffMs?: number
	store?: RunStore
	replanPolicy?: ReplanPolicy
	finalizer?: Finalizer
	// The per-run evidence hub agents read/write claims through. Optional: when
	// absent the executor falls back to an in-memory port so AgentContext.evidence
	// is always usable (core tests exercise the DAG without a DB). The real run
	// injects the Prisma-backed store (src/server/agentos/evidence-store.ts).
	evidence?: EvidencePort
	now?: Clock
	sleep?: (ms: number) => Promise<void>
}

const DEFAULT_STEP_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_BACKOFF_MS = 250

// A do-nothing finalizer used when none is injected (core tests). The real Final
// Synthesizer agent (M5) replaces it and is responsible for citing evidence ids
// and disclosing uncertainty (§13).
const defaultFinalizer: Finalizer = async (run) => {
	const terminal = Object.entries(run.stepStates).filter(([, s]) => s.status === 'succeeded')
	return {
		answer: `Run ${run.id} completed with ${terminal.length} succeeded step(s).`,
		citations: []
	}
}

export class OrchestraExecutor {
	private readonly registries: ExecutorRegistries
	private readonly options: ExecutorOptions
	private readonly bus: EventBus
	private readonly guard: BudgetGuard
	private readonly now: Clock
	private readonly sleep: (ms: number) => Promise<void>
	private readonly stepTimeoutMs: number
	private readonly maxRetries: number
	private readonly retryBackoffMs: number
	// The run's underlying evidence store (injected Prisma store, or an in-memory
	// fallback). buildContext wraps this so evidence writes emit the §13 events.
	private readonly evidence: EvidencePort

	constructor(registries: ExecutorRegistries, options: ExecutorOptions) {
		this.registries = registries
		this.options = options
		this.now = options.now ?? (() => Date.now())
		this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
		this.stepTimeoutMs = options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
		this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
		this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS
		this.evidence = options.evidence ?? createMemoryEvidence()
		this.guard = new BudgetGuard(options.limits, this.now)
		this.bus = new EventBus(options.store)
	}

	subscribe(subscriber: EventSubscriber): () => void {
		return this.bus.subscribe(subscriber)
	}

	private emit(event: OrchestrationEvent): void {
		this.bus.emit(event)
	}

	/**
	 * Execute one run to a terminal state. Never throws for expected failures
	 * (invalid plan, budget stop, failed steps) — those are recorded on the Run
	 * and reported via events. Only truly unexpected internal errors propagate.
	 */
	async execute(runId: string, query: string, plan: Plan): Promise<Run> {
		const startedAt = this.now()
		const run: Run = {
			id: runId,
			query,
			status: 'planning',
			plan,
			stepStates: {},
			shared: {},
			usage: this.guard.toUsage(),
			startedAt,
			finishedAt: null,
			finalAnswer: null,
			error: null
		}

		this.emit({ type: 'run_started', runId, query, at: startedAt })

		const validation = validatePlan(plan, this.registries)
		if (!validation.ok) {
			run.status = 'failed'
			run.error = `invalid_plan: ${validation.issues.map((i) => i.message).join('; ')}`
			this.emit({ type: 'error', runId, message: run.error, at: this.now() })
			await this.transition(run, 'failed')
			return run
		}

		for (const step of plan.steps) {
			run.stepStates[step.id] = {
				status: 'pending',
				attempts: 0,
				startedAt: null,
				finishedAt: null,
				result: null,
				error: null
			}
		}

		this.emit({ type: 'plan_created', runId, plan, at: this.now() })
		await this.transition(run, 'running')

		let budgetStopped: string | null = null

		// Replan loop (§10.6). Each pass runs every not-yet-terminal level set to
		// completion, then asks the replan policy whether to add steps. Bounded by
		// the guard's maxReplans; a budget stop breaks out immediately.
		while (true) {
			budgetStopped = await this.runPendingSteps(run)
			if (budgetStopped) break

			const delta = await this.maybeReplan(run)
			if (!delta) break
			// delta applied inside maybeReplan; loop again to run the new steps.
		}

		if (budgetStopped) {
			run.status = 'budget_stopped'
			run.error = `budget_stopped: ${budgetStopped}`
			// §10.7/§12: a budget stop is not an empty response. Run the finalizer over
			// whatever steps DID succeed so the client gets the best honest partial answer
			// (with the real citations gathered so far) alongside the reason. A finalizer
			// throw must never mask the stop, so it is guarded and the error event still
			// reports the truth. The `final` event carries the partial; the `error` event
			// and budget_stopped status carry the reason — the UI shows both.
			try {
				const finalizer = this.options.finalizer ?? defaultFinalizer
				const { answer, citations } = await finalizer(run)
				run.finalAnswer = answer
				this.emit({ type: 'final', runId, answer, citations, at: this.now() })
			} catch {
				// No partial answer available; the error event below is the honest report.
			}
			this.emit({ type: 'error', runId, message: run.error, at: this.now() })
			await this.transition(run, 'budget_stopped')
			return run
		}

		// A failed CRITICAL step that the replan policy could not resolve is an
		// honest failure, not a completion (§10.5).
		const unresolvedCritical = this.hasUnresolvedCriticalFailure(run)
		await this.transition(run, 'finalizing')

		if (unresolvedCritical) {
			run.status = 'failed'
			run.error = this.criticalFailureMessage(run)
			this.emit({ type: 'error', runId, message: run.error, at: this.now() })
			await this.transition(run, 'failed')
			return run
		}

		const finalizer = this.options.finalizer ?? defaultFinalizer
		const { answer, citations } = await finalizer(run)
		run.finalAnswer = answer
		run.status = 'completed'
		run.finishedAt = this.now()
		this.emit({ type: 'final', runId, answer, citations, at: run.finishedAt })
		await this.transition(run, 'completed')
		return run
	}

	// Runs every currently-pending step whose dependencies are satisfied, level
	// by level, until no more can start. Returns a budget-stop reason if the
	// guard refused a paid call, else null.
	private async runPendingSteps(run: Run): Promise<string | null> {
		while (true) {
			const ready = this.readySteps(run)
			if (ready.length === 0) return null

			// Steps in one dependency level are independent (§10.3) — run them in
			// parallel. A budget refusal inside any of them is surfaced after the
			// batch settles so we don't leave a promise un-awaited.
			let budgetReason: string | null = null
			await Promise.all(
				ready.map(async (step) => {
					const reason = await this.runStep(run, step)
					if (reason && !budgetReason) budgetReason = reason
				})
			)
			if (budgetReason) return budgetReason
		}
	}

	// A step is ready when it is pending and every dependency reached a terminal
	// state. A dependency that FAILED or was SKIPPED still unblocks the step —
	// whether the step should run at all is decided here: if any dependency did
	// not succeed, the step is skipped (its inputs can't be produced), unless it
	// is non-critical and has no hard data dependency the agent needs. We keep the
	// rule simple and honest: any non-succeeded dependency => skip.
	private readySteps(run: Run): PlanStep[] {
		const ready: PlanStep[] = []
		for (const step of run.plan.steps) {
			const state = run.stepStates[step.id]
			if (!state || state.status !== 'pending') continue
			const deps = step.dependsOn.map((id) => run.stepStates[id]?.status)
			const allTerminal = deps.every((d) => d === 'succeeded' || d === 'failed' || d === 'skipped')
			if (!allTerminal) continue
			const anyDepFailed = deps.some((d) => d === 'failed' || d === 'skipped')
			if (anyDepFailed) {
				// Can't run without its inputs — mark skipped, don't schedule.
				this.markSkipped(run, step, 'dependency_failed')
				continue
			}
			ready.push(step)
		}
		return ready
	}

	// Step states are seeded for every plan step before execution (and for every
	// delta step on replan), so a missing entry is an internal invariant breach,
	// not a runtime input case — throw rather than paper over it with a default.
	private stateOf(run: Run, stepId: string): StepState {
		const state = run.stepStates[stepId]
		if (!state) throw new Error(`missing step state for "${stepId}"`)
		return state
	}

	private markSkipped(run: Run, step: PlanStep, reason: string): void {
		const state = this.stateOf(run, step.id)
		state.status = 'skipped'
		state.finishedAt = this.now()
		state.error = reason
		this.emit({ type: 'agent_finished', runId: run.id, stepId: step.id, status: 'skipped', result: null, at: state.finishedAt })
	}

	// Execute one step with retries, timeout, and budget gating. Returns a
	// budget-stop reason if the guard refused the model call, else null.
	private async runStep(run: Run, step: PlanStep): Promise<string | null> {
		// Reserve the model-call slot up front. One reservation covers this step's
		// retries (transient re-attempts of the same logical call), and reserving
		// before the await is what keeps parallel steps in a level from all
		// slipping past the cap.
		const verdict = this.guard.reserveModelCall()
		if (!verdict.ok) {
			this.markSkipped(run, step, `budget:${verdict.reason}`)
			return verdict.reason
		}

		const state = this.stateOf(run, step.id)
		state.status = 'running'
		state.startedAt = this.now()
		this.emit({ type: 'model_selected', runId: run.id, stepId: step.id, model: step.model, at: this.now() })
		this.emit({ type: 'agent_started', runId: run.id, stepId: step.id, agent: step.agent, model: step.model, at: state.startedAt })
		await this.persist(run)

		// validatePlan already proved the agent exists; strict index access still
		// widens it, so assert the invariant rather than call .run on undefined.
		const agent = this.registries.agents[step.agent]
		if (!agent) throw new Error(`missing agent "${step.agent}" for step "${step.id}"`)
		const ctx = this.buildContext(run, step)

		let lastResult: StepResult | null = null
		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			state.attempts = attempt + 1
			try {
				const result = await this.withTimeout(agent.run(step.inputs, ctx))
				lastResult = result
				if (result.ok) {
					this.guard.addCost(result.costMicroUsd)
					this.applyResult(run, step, result)
					return null
				}
				// ok:false — retry only if the agent flagged it retryable.
				if (result.retryable && attempt < this.maxRetries) {
					await this.backoff(attempt)
					continue
				}
				this.guard.addCost(result.costMicroUsd)
				this.failStep(run, step, result.error ?? 'agent_returned_not_ok')
				return null
			} catch (error) {
				const message = error instanceof Error ? error.message : 'step_threw'
				// Thrown errors and timeouts are transient by default (§10.5).
				if (attempt < this.maxRetries) {
					await this.backoff(attempt)
					continue
				}
				lastResult = { ok: false, error: message }
				this.failStep(run, step, message)
				return null
			}
		}

		this.failStep(run, step, lastResult?.error ?? 'retries_exhausted')
		return null
	}

	private buildContext(run: Run, step: PlanStep): AgentContext {
		return {
			runId: run.id,
			query: run.query,
			model: step.model,
			shared: run.shared,
			budget: this.guard.snapshot,
			emit: (event) => this.emit(event),
			callTool: async (name: string, args: unknown): Promise<ToolResult> => {
				this.emit({ type: 'tool_call', runId: run.id, stepId: step.id, tool: name, args, at: this.now() })
				// Permission first — a disallowed tool must not consume any budget.
				if (!this.registries.tools?.has(name) || !step.toolsAllowed.includes(name)) {
					const res: ToolResult = { ok: false, error: `tool_not_allowed:${name}` }
					this.emit({ type: 'tool_result', runId: run.id, stepId: step.id, tool: name, ok: false, summary: res.error, latencyMs: 0, at: this.now() })
					return res
				}
				// Then reserve the tool-call slot (atomically counted on success).
				const toolVerdict = this.guard.reserveToolCall()
				if (!toolVerdict.ok) {
					const res: ToolResult = { ok: false, error: `budget:${toolVerdict.reason}` }
					this.emit({ type: 'tool_result', runId: run.id, stepId: step.id, tool: name, ok: false, summary: res.error, latencyMs: 0, at: this.now() })
					return res
				}
				const t0 = this.now()
				const result = await this.registries.tools.call(name, args)
				const latencyMs = this.now() - t0
				// A tool may itself spend real money (research-sonar calls a paid web
				// model). Record its cost against the run budget BEFORE the cost_update
				// so the per-run cap is never under-counted and the emitted total is
				// true. addCost ignores absent/non-positive values, so the keyless
				// calculator (no costMicroUsd) is a no-op.
				if (result.ok) this.guard.addCost(result.costMicroUsd)
				this.emit({
					type: 'tool_result',
					runId: run.id,
					stepId: step.id,
					tool: name,
					ok: result.ok,
					summary: result.ok ? result.summary : result.error,
					latencyMs,
					at: this.now()
				})
				this.emitCost(run)
				return result
			},
			evidence: this.buildEvidencePort(run)
		}
	}

	// Wrap the run's evidence store so writes emit the §13 events on the same bus as
	// everything else (one clock, one runId), while agents stay simple: they call
	// ctx.evidence.* and never touch emit for evidence. A store write is best-effort —
	// add/flagContradiction return '' when nothing persisted, and we emit an event
	// ONLY for a real id so the stream never points at a row that does not exist.
	private buildEvidencePort(run: Run): EvidencePort {
		const store = this.evidence
		return {
			add: async (input) => {
				const id = await store.add(input)
				if (id) {
					this.emit({
						type: 'evidence_added',
						runId: run.id,
						evidenceId: id,
						source: input.source ?? null,
						discoveredByAgent: input.discoveredByAgent,
						at: this.now()
					})
				}
				return id
			},
			list: () => store.list(),
			markVerification: async (id, status) => {
				await store.markVerification(id, status)
				// Emit ONLY for a real id so the stream never points at a row that does not
				// exist; the EVIDENCE GRAPH "verified" counter reads this (§13).
				if (id) {
					this.emit({
						type: 'evidence_verified',
						runId: run.id,
						evidenceId: id,
						status,
						at: this.now()
					})
				}
			},
			flagContradiction: async (input) => {
				const id = await store.flagContradiction(input)
				if (id) {
					this.emit({
						type: 'contradiction_found',
						runId: run.id,
						claim: input.claim,
						againstClaim: input.againstClaim,
						at: this.now()
					})
				}
				return id
			}
		}
	}

	private applyResult(run: Run, step: PlanStep, result: StepResult): void {
		const state = this.stateOf(run, step.id)
		state.status = 'succeeded'
		state.finishedAt = this.now()
		state.result = result
		// Downstream steps read prior outputs from shared[stepId] (§10.4).
		if (result.output) run.shared[step.id] = result.output
		this.emit({ type: 'agent_finished', runId: run.id, stepId: step.id, status: 'succeeded', result, at: state.finishedAt })
		this.emitCost(run)
	}

	private failStep(run: Run, step: PlanStep, error: string): void {
		const state = this.stateOf(run, step.id)
		state.status = 'failed'
		state.finishedAt = this.now()
		state.error = error
		this.emit({ type: 'agent_finished', runId: run.id, stepId: step.id, status: 'failed', result: state.result, at: state.finishedAt })
		this.emitCost(run)
	}

	private emitCost(run: Run): void {
		const usage = this.guard.toUsage()
		run.usage = usage
		this.emit({
			type: 'cost_update',
			runId: run.id,
			costMicroUsd: usage.costMicroUsd,
			modelCalls: usage.modelCalls,
			toolCalls: usage.toolCalls,
			at: this.now()
		})
	}

	// Ask the injected replan policy whether to add steps. Bounded by maxReplans
	// via the guard. On a delta: append + validate the new steps, seed their
	// pending state, emit `replan`, and return the delta so the caller loops.
	private async maybeReplan(run: Run): Promise<PlanDelta | null> {
		if (!this.options.replanPolicy) return null
		// Bound the round by BOTH the replan cap and the wall clock: the policy fires
		// Jev gate calls that are not reservation-gated, so without the clock check a
		// slow gate could push a run past its wall-clock cap (§12).
		if (!this.guard.canReplanRound().ok) return null

		const completedSteps = run.plan.steps.filter((s) => run.stepStates[s.id]?.status === 'succeeded')
		const failedSteps = run.plan.steps.filter((s) => run.stepStates[s.id]?.status === 'failed')
		const delta = await this.options.replanPolicy({ run, completedSteps, failedSteps })
		if (!delta || delta.add.length === 0) return null

		// Validate the delta against the same registries before adopting it; a
		// malformed delta is rejected (logged) rather than crashing the run.
		const merged: Plan = { steps: [...run.plan.steps, ...delta.add] }
		const validation = validatePlan(merged, this.registries)
		if (!validation.ok) {
			this.emit({ type: 'error', runId: run.id, message: `replan_rejected: ${validation.issues.map((i) => i.message).join('; ')}`, at: this.now() })
			return null
		}

		run.plan = merged
		for (const step of delta.add) {
			run.stepStates[step.id] = {
				status: 'pending',
				attempts: 0,
				startedAt: null,
				finishedAt: null,
				result: null,
				error: null
			}
		}
		this.guard.recordReplan()
		run.usage = this.guard.toUsage()
		await this.transition(run, 'replanning')
		this.emit({
			type: 'replan',
			runId: run.id,
			reason: delta.reason,
			addedSteps: delta.add.map((s) => s.id),
			replans: run.usage.replans,
			at: this.now()
		})
		// Back to running for the new steps.
		await this.transition(run, 'running')
		return delta
	}

	private hasUnresolvedCriticalFailure(run: Run): boolean {
		return run.plan.steps.some(
			(s) => s.critical && (run.stepStates[s.id]?.status === 'failed' || run.stepStates[s.id]?.status === 'skipped')
		)
	}

	// The bare token 'critical_step_failed' hides WHY the run died — e.g. an upstream
	// researcher's `NanoGPT 402: out of credits` — which is exactly what an operator
	// needs to act. Keep the token as a greppable prefix, then append the first FAILED
	// step's real stored error (a skipped dependent carries no cause of its own). The
	// detail is truncated so a long provider JSON payload can't bloat the event/row.
	private criticalFailureMessage(run: Run): string {
		const base = 'critical_step_failed'
		for (const step of run.plan.steps) {
			const state = run.stepStates[step.id]
			if (state?.status === 'failed' && state.error) {
				const detail = state.error.length > 240 ? `${state.error.slice(0, 240)}…` : state.error
				return `${base}: ${step.id} failed: ${detail}`
			}
		}
		return base
	}

	private async withTimeout<T>(promise: Promise<T>): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('step_timeout')), this.stepTimeoutMs)
		})
		try {
			return await Promise.race([promise, timeout])
		} finally {
			if (timer) clearTimeout(timer)
		}
	}

	private async backoff(attempt: number): Promise<void> {
		const ms = Math.min(2 ** attempt * this.retryBackoffMs, 30_000)
		await this.sleep(ms)
	}

	// Set status, stamp usage, emit a status event, and persist the aggregate.
	// §10.1: persisted after every state change (crash recovery + replay).
	private async transition(run: Run, status: RunStatus): Promise<void> {
		run.status = status
		run.usage = this.guard.toUsage()
		if (status === 'completed' || status === 'failed' || status === 'budget_stopped') {
			run.finishedAt = this.now()
		}
		this.emit({ type: 'status', runId: run.id, status, at: this.now() })
		await this.persist(run)
	}

	private async persist(run: Run): Promise<void> {
		if (!this.options.store) return
		try {
			await this.options.store.save(run)
		} catch {
			// Durability is best-effort at the core layer; the store logs its own
			// failures. A persist error must never kill an otherwise-healthy run.
		}
	}
}

// Convenience re-export so callers construct an executor without importing the
// StepState type separately.
export type { StepState }
