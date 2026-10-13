// The Skeptic / Fact-Checker (critic) agent's pure core (§11 "Skeptic/Fact-Checker" +
// §13). Split from the server wrapper so the "read evidence, judge it, never invent a
// verdict for a claim that isn't there" logic is unit-testable at $0 with a mocked
// model completer and an in-memory evidence hub.
//
// Flow: read every claim the run has gathered (ctx.evidence.list), ask the routed
// model — claude, the strongest reasoner (ROLE_MODEL) — for ONE structured JSON pass
// assigning each claim a verification status and naming any contradicting pairs, then
// apply those verdicts back to the hub. The critic only ever acts on ids that came
// from list(): an id it hallucinates is ignored, so a model can't mark a phantom claim
// "verified" (§8).
//
// This is the M5 fact-checker. The Jev D4 GATES that consume its verdicts (enough /
// valid / contradiction / finalization) are wired into the replan loop in M6 — this
// agent produces the evidence state those gates read.
//
// Pure: no 'server-only', no fetch, no Prisma, no SDK. The real model call and the
// real evidence store live behind the injected `completer` and `evidence`.

import { z } from 'zod'
import { isModelLabel } from '@/lib/models'
import type { EvidencePort, EvidenceView, VerificationStatus } from '@/lib/evidence'
import type { StepResult } from '@/lib/orchestra/types'

export const CRITIC_AGENT = 'critic'

// One short JSON pass over a handful of claims; 512 tokens is ample and keeps
// NanoGPT's credit reserve small (same 402 rationale as the other agents).
const DEFAULT_CRITIC_MAX_TOKENS = 512

export type CriticMessage = { role: 'system' | 'user'; content: string }

export type CriticModelCompletion = {
	text: string
	tokens: { input: number; output: number }
	costMicroUsd?: number
}

// Injected so the core never imports the server-only NanoGPT/trackAiCall path.
// Throws on a failed call, carrying an optional HTTP `status` so runCriticStep can
// decide retryability — the same contract the code/generating agents rely on.
export type CriticCompleter = (
	messages: CriticMessage[],
	maxTokens: number
) => Promise<CriticModelCompletion>

export type CriticStepDeps = {
	// The model the Decision Bus routed to this step (ctx.model); validated with
	// isModelLabel before any paid call.
	model: string
	evidence: EvidencePort
	completer: CriticCompleter
	maxTokens?: number
	notes?: string
}

export const CRITIC_SYSTEM_PROMPT =
	'You are the Skeptic / Fact-Checker inside AgentOS, an adaptive multi-agent system. ' +
	'You are given a numbered list of claims gathered by other agents, each with an id and the source (if any) it was drawn from. ' +
	'Judge each claim on the strength of its support: ' +
	'"verified" only when the cited source clearly backs it; ' +
	'"contested" when support is weak, thin, or conflicts with another claim; ' +
	'"refuted" when it is contradicted by the evidence; ' +
	'"unverified" when you cannot tell. ' +
	'Also name any pair of claims that cannot both be true. ' +
	'Refer to claims ONLY by the ids given; never invent an id. ' +
	'Output ONLY compact JSON, no prose and no code fence, of exactly this shape: ' +
	'{"verdicts":[{"id":"<id>","status":"verified|contested|refuted|unverified","reason":"<short>"}],' +
	'"contradictions":[{"claimId":"<id>","againstId":"<id>","reason":"<short>"}]}'

// The model's JSON, parsed defensively. `id`s are accepted as string or number and
// normalized to string (the hub's ids are strings). The envelope reads each array as
// `unknown[]` and validates elements ONE BY ONE (below), so a single malformed verdict
// is dropped rather than discarding the whole pass — the same per-element granularity
// the research parser uses.
const idSchema = z.union([z.string(), z.number()]).transform((v) => String(v))
const statusSchema = z.enum(['verified', 'contested', 'refuted', 'unverified'])

const verdictElementSchema = z.object({
	id: idSchema,
	status: statusSchema,
	reason: z.string().nullish()
})

const contradictionElementSchema = z.object({
	claimId: idSchema,
	againstId: idSchema,
	reason: z.string().nullish()
})

const envelopeSchema = z.object({
	verdicts: z.array(z.unknown()).nullish(),
	contradictions: z.array(z.unknown()).nullish()
})

export type CriticVerdict = {
	verdicts: Array<{ id: string; status: VerificationStatus; reason?: string }>
	contradictions: Array<{ claimId: string; againstId: string; reason?: string }>
}

// Pull the first JSON object out of a model reply that may wrap it in a code fence or
// surrounding prose. Returns null when there is no parseable object.
function extractJsonObject(text: string): unknown | null {
	const trimmed = text
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/```\s*$/, '')
		.trim()
	const tryParse = (s: string): unknown | null => {
		try {
			return JSON.parse(s) as unknown
		} catch {
			return null
		}
	}
	const direct = tryParse(trimmed)
	if (direct != null && typeof direct === 'object') return direct
	const start = trimmed.indexOf('{')
	const end = trimmed.lastIndexOf('}')
	if (start !== -1 && end > start) {
		const sliced = tryParse(trimmed.slice(start, end + 1))
		if (sliced != null && typeof sliced === 'object') return sliced
	}
	return null
}

/**
 * Parse the critic model's reply into verdicts + contradictions. Never throws and
 * never fabricates: an unparseable reply yields empty lists (the claims simply stay
 * `unverified`), and any individual element that fails validation is dropped rather
 * than taking the whole pass with it.
 */
export function parseCriticVerdict(text: string): CriticVerdict {
	const json = extractJsonObject(text)
	if (json == null) return { verdicts: [], contradictions: [] }
	const envelope = envelopeSchema.safeParse(json)
	if (!envelope.success) return { verdicts: [], contradictions: [] }

	const verdicts: CriticVerdict['verdicts'] = []
	for (const raw of envelope.data.verdicts ?? []) {
		const el = verdictElementSchema.safeParse(raw)
		if (!el.success) continue
		verdicts.push({
			id: el.data.id,
			status: el.data.status,
			...(el.data.reason ? { reason: el.data.reason } : {})
		})
	}

	const contradictions: CriticVerdict['contradictions'] = []
	for (const raw of envelope.data.contradictions ?? []) {
		const el = contradictionElementSchema.safeParse(raw)
		if (!el.success) continue
		contradictions.push({
			claimId: el.data.claimId,
			againstId: el.data.againstId,
			...(el.data.reason ? { reason: el.data.reason } : {})
		})
	}

	return { verdicts, contradictions }
}

// The numbered claim list handed to the model. Ids are the hub's real ids so the
// model's verdicts map back exactly; the source is shown so "verified" means
// source-backed, not the model's own belief.
function buildClaimList(rows: EvidenceView[]): string {
	return rows
		.map((row) => {
			const source = row.source ? row.source : 'no source'
			return `#${row.id} [${row.verificationStatus}] ${row.claim} (source: ${source})`
		})
		.join('\n')
}

/**
 * Run one Fact-Checker step: read evidence -> one model pass -> apply verdicts.
 *
 * No evidence is a clean no-op success (nothing to check), not a failure. Verdicts and
 * contradictions are applied ONLY to ids that exist in the hub; a hallucinated id is
 * ignored. A contradiction flips the offending row to `contradicts` and marks BOTH
 * claims `contested` — two conflicting claims cannot both stay verified. The model's
 * real cost/tokens are returned so the budget guard records true spend.
 */
export async function runCriticStep(deps: CriticStepDeps): Promise<StepResult> {
	if (!isModelLabel(deps.model)) {
		return { ok: false, error: `unknown_model:${deps.model}`, retryable: false }
	}

	const rows = await deps.evidence.list()
	if (rows.length === 0) {
		return {
			ok: true,
			output: {
				text: 'No evidence was gathered, so there was nothing to fact-check.',
				checked: 0,
				verdictsApplied: 0,
				contradictions: 0
			},
			notes: deps.notes ?? 'critic: no evidence to check',
			tokens: { input: 0, output: 0 }
		}
	}

	const maxTokens = deps.maxTokens ?? DEFAULT_CRITIC_MAX_TOKENS
	const messages: CriticMessage[] = [
		{ role: 'system', content: CRITIC_SYSTEM_PROMPT },
		{ role: 'user', content: buildClaimList(rows) }
	]

	let completion: CriticModelCompletion
	try {
		completion = await deps.completer(messages, maxTokens)
	} catch (error) {
		const status = (error as { status?: number } | null)?.status
		const retryable = status == null || status === 429 || status >= 500
		const message = error instanceof Error ? error.message : 'model_call_failed'
		return { ok: false, error: message, retryable }
	}

	const verdict = parseCriticVerdict(completion.text)
	const byId = new Map(rows.map((row) => [row.id, row]))
	const summary: string[] = []

	let verdictsApplied = 0
	for (const v of verdict.verdicts) {
		const row = byId.get(v.id)
		// Ignore an id that isn't in the hub — never act on a claim that doesn't exist.
		if (!row) continue
		await deps.evidence.markVerification(v.id, v.status)
		verdictsApplied++
		summary.push(`#${v.id} ${v.status}${v.reason ? `: ${v.reason}` : ''}`)
	}

	let contradictions = 0
	for (const c of verdict.contradictions) {
		const claimRow = byId.get(c.claimId)
		const againstRow = byId.get(c.againstId)
		if (!claimRow || !againstRow || claimRow === againstRow) continue
		const id = await deps.evidence.flagContradiction({
			claimId: c.claimId,
			againstId: c.againstId,
			claim: claimRow.claim,
			againstClaim: againstRow.claim,
			discoveredByAgent: CRITIC_AGENT,
			source: claimRow.source
		})
		if (!id) continue
		// A contradiction means neither claim can stand as verified.
		await deps.evidence.markVerification(claimRow.id, 'contested')
		await deps.evidence.markVerification(againstRow.id, 'contested')
		contradictions++
		summary.push(
			`contradiction: #${c.claimId} vs #${c.againstId}${c.reason ? `: ${c.reason}` : ''}`
		)
	}

	const text =
		summary.length > 0 ? summary.join('\n') : 'Fact-check produced no applicable verdicts.'
	return {
		ok: true,
		output: { text, checked: rows.length, verdictsApplied, contradictions },
		notes:
			deps.notes ??
			`critic checked ${rows.length} claim(s): ${verdictsApplied} verdict(s), ${contradictions} contradiction(s)`,
		tokens: completion.tokens,
		costMicroUsd: completion.costMicroUsd
	}
}
