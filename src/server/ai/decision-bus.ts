import 'server-only'
import { DecisionBus, type DecisionBusDeps, type DecisionRecord, type JevAsk } from '@/lib/decisions'
import { askJev } from './jev'

// The server-side glue between the pure Decision Bus (src/lib/decisions) and the
// real Jev transport. The bus is injectable and unit-tested with a mocked ask;
// this is the ONE place the real askJev is bound, so the pure module never
// imports a 'server-only' dependency.
//
// askJev's JevAskResult and JevQuestions are structurally identical to the bus's
// JevAskOutcome/JevQuestionsSpec (deliberately — see decisions/types.ts), so the
// adapter is a passthrough with no mapping and no copying.
const jevAsk: JevAsk = (state, questions) => askJev(state, questions)

export type CreateDecisionBusOptions = {
	// Optional persistence sink, called once per DecisionRecord as it is made.
	// Best-effort: the bus swallows a sink failure and still returns the record.
	record?: (record: DecisionRecord) => void | Promise<void>
	// Injectable clock (defaults to Date.now); tests pass a fixed one.
	now?: () => number
}

export function createDecisionBus(options: CreateDecisionBusOptions = {}): DecisionBus {
	const deps: DecisionBusDeps = { ask: jevAsk, record: options.record, now: options.now }
	return new DecisionBus(deps)
}
