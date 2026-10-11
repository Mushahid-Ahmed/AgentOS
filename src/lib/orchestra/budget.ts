import type { BudgetLimits, BudgetSnapshot, BudgetUsage, BudgetVerdict } from './types'

// Budget guard (§10.7, caps from §12). A tiny mutable counter set checked
// BEFORE every model call, every tool call, and every replan. On any cap hit it
// returns a `{ ok:false, reason }` verdict and the executor stops launching paid
// work, marks the run `budget_stopped`, and returns the best honest partial
// answer — it never silently overspends (§8).
//
// `elapsedMs` is computed from an injected clock so wall-clock limiting is
// testable without real sleeping.

export type Clock = () => number

export class BudgetGuard {
	private readonly limits: BudgetLimits
	private readonly now: Clock
	private readonly usage: BudgetUsage

	constructor(limits: BudgetLimits, now: Clock) {
		this.limits = limits
		this.now = now
		this.usage = {
			costMicroUsd: 0,
			modelCalls: 0,
			toolCalls: 0,
			replans: 0,
			startedAt: now()
		}
	}

	get snapshot(): BudgetSnapshot {
		return { ...this.usage, elapsedMs: this.now() - this.usage.startedAt, limits: this.limits }
	}

	// May we make another paid model call? Checks the cost/model-call/wall-clock
	// caps and, when ok, ATOMICALLY reserves the slot by incrementing modelCalls
	// before returning. Reservation (not a bare read) is what makes the guard
	// correct under parallel step execution: independent steps in one DAG level
	// are launched together, and JS runs each synchronous reserve-to-completion
	// with no await in between, so N concurrent steps can never all slip past a
	// cap of M < N. The replan cap is NOT checked here (see canReplan).
	reserveModelCall(): BudgetVerdict {
		const verdict = this.checkPaid()
		if (verdict.ok) this.usage.modelCalls += 1
		return verdict
	}

	// May we make another tool call? Tools can cost (research-sonar) or be free
	// (calculator), but they consume the tool-call budget and the wall clock
	// either way. Reserves the tool-call slot on success, same rationale as above.
	reserveToolCall(): BudgetVerdict {
		if (this.usage.toolCalls >= this.limits.maxToolCalls) {
			return { ok: false, reason: 'max_tool_calls' }
		}
		const clock = this.checkClock()
		if (clock.ok) this.usage.toolCalls += 1
		return clock
	}

	canReplan(): BudgetVerdict {
		if (this.usage.replans >= this.limits.maxReplans) {
			return { ok: false, reason: 'max_replans' }
		}
		return { ok: true }
	}

	// May we start ANOTHER replan round? A round fires Jev gate calls and then new
	// paid steps, but the gate calls themselves are not reservation-gated (they happen
	// inside the policy, between step launches), so a run that is already out of wall
	// clock could otherwise stall in a slow gate and blow past the cap. The executor
	// checks this before invoking the replan policy: past the wall clock (or the
	// replan cap) the loop breaks and finalizes on what it has, honestly.
	canReplanRound(): BudgetVerdict {
		const replan = this.canReplan()
		if (!replan.ok) return replan
		return this.checkClock()
	}

	private checkPaid(): BudgetVerdict {
		// The cost cap is inherently checked against cost accumulated SO FAR: a
		// call's own cost is unknown until NanoGPT returns it, so the guard
		// can only refuse the NEXT call once prior spend has crossed the cap.
		// Sequential steps therefore trip it deterministically; parallel steps in
		// one level are gated by the model-call and wall-clock caps instead.
		if (this.usage.costMicroUsd >= this.limits.maxCostMicroUsd) {
			return { ok: false, reason: 'max_cost' }
		}
		if (this.usage.modelCalls >= this.limits.maxModelCalls) {
			return { ok: false, reason: 'max_model_calls' }
		}
		return this.checkClock()
	}

	private checkClock(): BudgetVerdict {
		if (this.elapsedMs() >= this.limits.maxWallClockMs) {
			return { ok: false, reason: 'max_wall_clock' }
		}
		return { ok: true }
	}

	private elapsedMs(): number {
		return this.now() - this.usage.startedAt
	}

	// Add a completed call's real cost, in integer millionths (matches the
	// cost_micro_usd convention). The call count was already reserved, so this
	// only records spend. A null/absent/non-positive cost adds nothing rather
	// than inventing a number (§1.3).
	addCost(costMicroUsd?: number | null): void {
		if (typeof costMicroUsd === 'number' && Number.isFinite(costMicroUsd) && costMicroUsd > 0) {
			this.usage.costMicroUsd += Math.round(costMicroUsd)
		}
	}

	recordReplan(): void {
		this.usage.replans += 1
	}

	// Exposed so the executor can seed the persisted Run.usage each state change.
	toUsage(): BudgetUsage {
		return { ...this.usage }
	}
}
