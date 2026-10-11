// Decision Bus barrel (§11). The bus is pure/injectable; the real Jev transport
// adapter lives server-side (src/server/ai/decision-bus.ts) and is NOT re-exported
// here so this module stays isomorphic and unit-testable.
export { DecisionBus } from './bus'
export * from './types'
export {
	planningQuestions,
	sufficiencyQuestions,
	validityQuestions,
	contradictionQuestions,
	finalizationQuestions,
	PLAN_QUESTION
} from './questions'
export {
	assembleTeam,
	policyTaskType,
	policyComplexity,
	policyModelForRole,
	policyModelRouting,
	policyExecutionMode,
	POLICY_GATE_DEFAULTS
} from './policy'
