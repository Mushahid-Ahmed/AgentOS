// Jev question builders for the Decision Bus. Each function returns the
// `questions` map sent to Jev (via the injected ask). Batching matters: the free
// tier bills `state` once per call and throttles per call, so ALL planning
// questions go in ONE call (docs/agentos-integration-notes.md §1b). The two D4
// gates and finalization are separate single-question calls made later in the
// run, spaced by the transport's own backoff.
//
// Criteria text is deliberately behaviour-flavoured (the shape of the task, not
// brand loyalty) so Jev's choice is about intent. `choice` criteria is an OBJECT
// (label -> meaning); a bare `score` with no anchor array is a 400 (§1a), so the
// MVP uses `choice` tiers throughout.

import { MODEL_LABELS, ROUTE_CRITERIA } from '@/lib/models'
import { COMPLEXITY_TIERS, TASK_TYPES, type JevQuestionsSpec } from './types'

// The names of each question in the planning batch. The bus reads answers by
// these keys, so they are exported to keep the builder and the reader in sync.
export const PLAN_QUESTION = {
	taskType: 'task_type',
	complexity: 'complexity_tier',
	needsResearch: 'needs_research',
	needsCode: 'needs_code',
	needsCritic: 'needs_critic',
	bestModel: 'best_model'
} as const

const TASK_TYPE_CRITERIA: Record<(typeof TASK_TYPES)[number], string> = {
	research: 'Open-ended investigation that needs external facts, sources, or synthesis across material the model was not given.',
	comparison: 'Weighing two or more options, models, tools, or approaches against criteria to reach a recommendation.',
	coding: 'Writing, debugging, reviewing, or explaining code; a defect to fix or a program to build.',
	data: 'Arithmetic, units, aggregation, statistics, or a numeric/calculation-heavy question.',
	document_qa: 'Answering strictly from a specific document, passage, or context the user supplied.',
	simple: 'A trivially simple factual or one-line question needing a single model and no extra agents.'
}

const COMPLEXITY_CRITERIA: Record<(typeof COMPLEXITY_TIERS)[number], string> = {
	simple: 'One cheap/fast model can finish confidently in a single step.',
	medium: 'A small team plus retrieval and one verification pass is warranted.',
	hard: 'Multiple agents, tools, a critic, and a sufficiency check with possible replan.',
	very_hard: 'Several strong models in parallel with cross-critique, evidence verification, and a judging pass.'
}

const YES_NO = { yes: 'Yes — this task needs it.', no: 'No — this task does not need it.' }

// The single batched planning call: task type, complexity tier, the three
// needs_* team signals, and the lead model. Six questions, one hop.
export function planningQuestions(): JevQuestionsSpec {
	return {
		[PLAN_QUESTION.taskType]: {
			type: 'choice',
			instructions: 'Classify the user query in the state into exactly one task type.',
			criteria: TASK_TYPE_CRITERIA
		},
		[PLAN_QUESTION.complexity]: {
			type: 'choice',
			instructions: 'Judge how much orchestration this query needs.',
			criteria: COMPLEXITY_CRITERIA
		},
		[PLAN_QUESTION.needsResearch]: {
			type: 'choice',
			instructions: 'Does answering well require retrieving external facts or sources?',
			criteria: YES_NO
		},
		[PLAN_QUESTION.needsCode]: {
			type: 'choice',
			instructions: 'Does answering require a calculation, data transform, or code execution?',
			criteria: YES_NO
		},
		[PLAN_QUESTION.needsCritic]: {
			type: 'choice',
			instructions: 'Is the claim load-bearing enough to warrant an adversarial critic/skeptic pass?',
			criteria: YES_NO
		},
		[PLAN_QUESTION.bestModel]: {
			type: 'choice',
			instructions: 'Pick the single model best suited to produce the final answer for this query.',
			criteria: Object.fromEntries(MODEL_LABELS.map((label) => [label, ROUTE_CRITERIA[label]]))
		}
	}
}

// Gate 1 (D4): "Enough evidence?" -> enough | insufficient.
export const SUFFICIENCY_QUESTION = 'enough_evidence'
export function sufficiencyQuestions(): JevQuestionsSpec {
	return {
		[SUFFICIENCY_QUESTION]: {
			type: 'choice',
			instructions: 'Given the evidence gathered so far in the state, is it enough to answer confidently?',
			criteria: {
				enough: 'The gathered evidence is sufficient to answer the query confidently now.',
				insufficient: 'More research or another agent is needed before answering.'
			}
		}
	}
}

// Gate 2 (D4): "Evidence valid?" -> valid | invalid.
export const VALIDITY_QUESTION = 'evidence_valid'
export function validityQuestions(): JevQuestionsSpec {
	return {
		[VALIDITY_QUESTION]: {
			type: 'choice',
			instructions: 'After the critic pass in the state, is the evidence valid and non-contradictory?',
			criteria: {
				valid: 'The evidence holds up; no unresolved contradiction blocks the answer.',
				invalid: 'A contradiction or unsupported claim means the evidence needs rework.'
			}
		}
	}
}

// Contradiction detection (feeds the skeptic / D2 relation graph).
export const CONTRADICTION_QUESTION = 'contradiction_detected'
export function contradictionQuestions(): JevQuestionsSpec {
	return {
		[CONTRADICTION_QUESTION]: {
			type: 'choice',
			instructions: 'Do any gathered claims in the state contradict each other?',
			criteria: {
				yes: 'At least two claims conflict and cannot both be true.',
				no: 'The claims are mutually consistent.'
			}
		}
	}
}

// Finalization (D1 PASS/REWORK): pass -> final answer, rework -> loop back.
export const FINALIZATION_QUESTION = 'finalization'
export function finalizationQuestions(): JevQuestionsSpec {
	return {
		[FINALIZATION_QUESTION]: {
			type: 'choice',
			instructions: 'Given the verified answer in the state, should the run finalize or rework?',
			criteria: {
				pass: 'The answer is well-supported; finalize it.',
				rework: 'The answer is weak or unsupported; spawn/activate another agent and loop back.'
			}
		}
	}
}
