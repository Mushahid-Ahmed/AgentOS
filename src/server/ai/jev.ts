import 'server-only'
import { env } from '@/lib/env'
import { log } from '@/server/lib/logger'
import { DEFAULT_LABEL, MODEL_LABELS, ROUTE_CRITERIA, isModelLabel, type ModelLabel } from '@/lib/models'

// Jev router — the "System One" decision model, reached through BeatAPI's
// capability-run REST endpoint (access path (A), verified live in
// docs/jev-integration-notes.md §7). Raw `fetch`, not an SDK: there is no
// BeatAPI SDK to import, and using fetch keeps this file out of the
// no-restricted-imports AI-SDK rule (that rule governs the answer providers).
//
// Jev decides *which* model should answer; it never generates the answer text
// (capability description, §1). One `choice` question named `route`, criteria
// keys exactly claude|gpt|gemini. We read answers.route.{choice, confidence,
// probabilities}.
//
// Jev is not tracked in the ai_usage ledger, on purpose: it is the free
// BeatAPI capability ($0/$0) and not a NanoGPT-priced model, so it has no
// slug in NANOGPT_SLUGS and no cost to record. What matters about Jev — its
// real per-turn latency and the routing decision — is persisted in route_events
// by src/server/api/chat.ts instead. The three answer models it routes to ARE
// tracked there via trackAiCall.

const JEV_RUN_URL = 'https://api.beatapi.io/v1/capabilities/run'
const JEV_REFERENCE = 'model:jev-1.13-free'

// Hard ceiling on the routing hop. Jev measured ~0.7s cold end-to-end (§7);
// 4s gives headroom for a warm-but-slow call without letting a hung gateway
// stall the whole chat. On timeout we fall back rather than fail the request —
// a routed answer is the product, and DEFAULT_LABEL still produces one.
const JEV_TIMEOUT_MS = 4000

// What each label is *for* — the choice criteria Jev routes between — now lives
// in @/lib/models (isomorphic, shared by the chat router, the judge, and the
// Decision Bus). Re-exported here so existing importers of './jev' keep working
// from that one canonical definition.
export { ROUTE_CRITERIA }

const ROUTE_INSTRUCTIONS =
	'Pick the single model best suited to answer the user query in the state. Judge by the shape and intent of the task.'

export type RouteResult = {
	label: ModelLabel
	// Jev's own calibrated certainty (0..1). Distinct from the top probability
	// — see §7: confidence 0.64 vs top probability 0.76 on the same call.
	confidence: number
	// Per-label distribution (0..1 each), for the routing visualizer.
	probabilities: Record<ModelLabel, number>
	// Milliseconds spent in the Jev hop only, measured server-side. This is the
	// number the UI shows — never the brief's un-reproduced "~30-50ms".
	jevLatencyMs: number
	// True when we could not trust Jev's answer (error/timeout/invalid label)
	// and used DEFAULT_LABEL instead. The UI surfaces this honestly.
	fallback: boolean
	fallbackReason?: string
}

type JevChoiceAnswer = {
	type?: string
	choice?: unknown
	confidence?: unknown
	probabilities?: unknown
}

type JevRunResponse = {
	answers?: { route?: JevChoiceAnswer }
	error?: { code?: string; message?: string; retryable?: boolean; request_id?: string }
}

// ---- Generalized multi-question calls (AgentOS Decision Bus) -------------
//
// The single-`route` contract above is what the chat path uses. The Decision
// Bus needs ARBITRARY bounded decisions over custom label sets, batched into
// ONE call so the free-tier state is billed once and the throttle window is
// hit once, not per decision. Verified live in docs/agentos-integration-notes.md
// §1a: four custom-criteria `choice` questions returned HTTP 200 in one call.
//
// `choice` criteria is an OBJECT (label -> meaning); `score` criteria is an
// ARRAY of ascending scale anchors (a bare score with no criteria array is a
// 400 — §1a). Only `choice` is used by the MVP; `score` is typed for the M3+
// numeric-complexity add once an anchor array is passed.

export type JevQuestion =
	| { type: 'choice'; instructions?: string; criteria: Record<string, string> }
	| { type: 'score'; instructions?: string; criteria: string[] }

export type JevQuestions = Record<string, JevQuestion>

export type JevAnswer = {
	type: string
	// Present for a `choice` answer.
	choice?: string
	// Present for a `score` answer.
	score?: number
	// Jev's calibrated certainty (0..1). Distinct from the top probability.
	confidence: number
	// Per-label distribution for a `choice` answer (0..1 each).
	probabilities?: Record<string, number>
}

export type JevAskResult =
	| { ok: true; answers: Record<string, JevAnswer>; latencyMs: number; attempts: number }
	| { ok: false; error: string; latencyMs: number; attempts: number }

// The generalized run response: answers keyed by question name, each a loose
// shape we normalize defensively (Jev's exact per-type fields are not fully
// documented, so we read only what we can validate).
type JevAskResponse = {
	answers?: Record<string, { type?: string; choice?: unknown; score?: unknown; confidence?: unknown; probabilities?: unknown }>
	error?: { code?: string; message?: string; retryable?: boolean; retry_after_seconds?: number; request_id?: string }
}

const EMPTY_PROBABILITIES: Record<ModelLabel, number> = { claude: 0, gpt: 0, gemini: 0 }

function fallback(reason: string, jevLatencyMs: number): RouteResult {
	return {
		label: DEFAULT_LABEL,
		confidence: 0,
		probabilities: { ...EMPTY_PROBABILITIES },
		jevLatencyMs,
		fallback: true,
		fallbackReason: reason
	}
}

// Coerce Jev's `probabilities` into a full Record<ModelLabel, number>, filling
// any missing label with 0 and dropping anything that isn't one of ours.
function normalizeProbabilities(raw: unknown): Record<ModelLabel, number> {
	const out: Record<ModelLabel, number> = { ...EMPTY_PROBABILITIES }
	if (raw && typeof raw === 'object') {
		for (const label of MODEL_LABELS) {
			const value = (raw as Record<string, unknown>)[label]
			if (typeof value === 'number' && Number.isFinite(value)) {
				out[label] = value
			}
		}
	}
	return out
}

/**
 * Route a user query to one of claude|gpt|gemini via Jev.
 *
 * Never throws and never fails the chat: any error, timeout, or out-of-vocab
 * label resolves to a fallback RouteResult on DEFAULT_LABEL with `fallback:true`
 * and a reason, so the caller can still stream an answer and the UI can show
 * that routing degraded.
 */
export async function routeQuery(query: string): Promise<RouteResult> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS)
	const startedAt = performance.now()

	try {
		const response = await fetch(JEV_RUN_URL, {
			method: 'POST',
			signal: controller.signal,
			headers: {
				Authorization: `Bearer ${env.BEATAPI_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: jevRequestBody(query)
		})

		const jevLatencyMs = Math.round(performance.now() - startedAt)

		if (!response.ok) {
			// 429 (free-tier rate limit) and 5xx are the realistic cases; both
			// are recoverable by falling back for this one request.
			return fallback(`jev_http_${response.status}`, jevLatencyMs)
		}

		const data = (await response.json()) as JevRunResponse
		const answer = data.answers?.route

		if (!answer || !isModelLabel(answer.choice)) {
			// Either a malformed payload or a label outside our vocab — the
			// brief says stop-and-tell for the latter, which we surface via
			// fallbackReason (and log) rather than crashing the chat.
			const raw = typeof answer?.choice === 'string' ? answer.choice : 'missing'
			log.warn('jev route label outside vocabulary, falling back', { rawLabel: raw })
			return fallback(`invalid_label:${raw}`, jevLatencyMs)
		}

		return {
			label: answer.choice,
			confidence:
				typeof answer.confidence === 'number' && Number.isFinite(answer.confidence)
					? answer.confidence
					: 0,
			probabilities: normalizeProbabilities(answer.probabilities),
			jevLatencyMs,
			fallback: false
		}
	} catch (error) {
		const jevLatencyMs = Math.round(performance.now() - startedAt)
		const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network'
		log.warn('jev routing failed, falling back', { reason })
		return fallback(reason, jevLatencyMs)
	} finally {
		clearTimeout(timer)
	}
}

// The one `route` choice question, serialized. Shared by routeQuery (chat) and
// routeQueryMeasured (benchmark) so both send Jev the identical contract — the
// comparison is only fair if the request is byte-for-byte the same shape.
function jevRequestBody(query: string): string {
	return JSON.stringify({
		reference: JEV_REFERENCE,
		input: {
			state: query,
			questions: {
				route: {
					type: 'choice',
					instructions: ROUTE_INSTRUCTIONS,
					criteria: ROUTE_CRITERIA
				}
			}
		}
	})
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

// BeatAPI's free tier 429s after a handful of rapid calls (see
// docs/jev-integration-notes.md §7). The benchmark runs at concurrency 1 and
// honors Retry-After rather than hammering: cap the retries high enough to sit
// out a ~20s window a few times over, and add a small buffer so we don't wake
// exactly on the boundary and eat another 429.
const BENCH_MAX_RETRIES = 8
const BENCH_RETRY_BUFFER_MS = 250
const BENCH_MAX_BACKOFF_MS = 30_000

export type MeasuredRouteResult =
	| {
			ok: true
			label: ModelLabel
			confidence: number
			probabilities: Record<ModelLabel, number>
			// Latency of the successful hop only — throttle waits are a harness
			// artifact, not Jev's routing latency, so they are excluded.
			jevLatencyMs: number
			attempts: number
	  }
	| {
			ok: false
			error: string
			jevLatencyMs: number
			attempts: number
	  }

export type ThrottleHooks = {
	// Called before each throttle/backoff wait so the benchmark stream can report
	// honest progress ("waiting Ns — Jev free-tier rate limit") instead of
	// looking hung.
	onWait?: (waitMs: number, attempt: number, reason: string) => void
}

// Retry-After is either integer seconds or an HTTP date; BeatAPI also surfaces
// error.retry_after_seconds in the body. Prefer the header, then the body, then
// exponential backoff. Never negative, never unbounded.
async function retryAfterMs(response: Response, attempt: number): Promise<number> {
	const header = response.headers.get('retry-after')
	if (header) {
		const seconds = Number.parseInt(header, 10)
		if (Number.isFinite(seconds) && seconds >= 0) {
			return Math.min(seconds * 1000 + BENCH_RETRY_BUFFER_MS, BENCH_MAX_BACKOFF_MS)
		}
		const date = Date.parse(header)
		if (!Number.isNaN(date)) {
			return Math.min(Math.max(0, date - Date.now()) + BENCH_RETRY_BUFFER_MS, BENCH_MAX_BACKOFF_MS)
		}
	}
	try {
		const data = (await response.clone().json()) as { error?: { retry_after_seconds?: number } }
		const seconds = data.error?.retry_after_seconds
		if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
			return Math.min(seconds * 1000 + BENCH_RETRY_BUFFER_MS, BENCH_MAX_BACKOFF_MS)
		}
	} catch {
		// no parsable body — fall through to backoff
	}
	return backoffMs(attempt)
}

function backoffMs(attempt: number): number {
	return Math.min(2 ** attempt * 500 + BENCH_RETRY_BUFFER_MS, BENCH_MAX_BACKOFF_MS)
}

/**
 * Route a query via Jev for the BENCHMARK suite (not the chat path).
 *
 * Unlike routeQuery this never falls back to DEFAULT_LABEL: a benchmark must
 * record Jev's real decision or a real failure, so a 429/5xx/timeout is retried
 * (honoring Retry-After) and, once retries are exhausted, returned as
 * `{ ok:false, error }`. Only the successful hop is timed, so throttle waits
 * never inflate the measured routing latency.
 */
export async function routeQueryMeasured(
	query: string,
	hooks: ThrottleHooks = {}
): Promise<MeasuredRouteResult> {
	let lastLatencyMs = 0

	for (let attempt = 0; attempt <= BENCH_MAX_RETRIES; attempt++) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS)
		const startedAt = performance.now()

		try {
			const response = await fetch(JEV_RUN_URL, {
				method: 'POST',
				signal: controller.signal,
				headers: {
					Authorization: `Bearer ${env.BEATAPI_API_KEY}`,
					'Content-Type': 'application/json'
				},
				body: jevRequestBody(query)
			})
			const jevLatencyMs = Math.round(performance.now() - startedAt)
			lastLatencyMs = jevLatencyMs

			if (response.status === 429 || response.status >= 500) {
				if (attempt < BENCH_MAX_RETRIES) {
					const waitMs = await retryAfterMs(response, attempt)
					hooks.onWait?.(waitMs, attempt + 1, `jev_http_${response.status}`)
					await sleep(waitMs)
					continue
				}
				return { ok: false, error: `jev_http_${response.status}`, jevLatencyMs, attempts: attempt + 1 }
			}

			if (!response.ok) {
				// A 4xx other than 429 won't be fixed by retrying.
				return { ok: false, error: `jev_http_${response.status}`, jevLatencyMs, attempts: attempt + 1 }
			}

			const data = (await response.json()) as JevRunResponse
			const answer = data.answers?.route

			if (!answer || !isModelLabel(answer.choice)) {
				const raw = typeof answer?.choice === 'string' ? answer.choice : 'missing'
				return { ok: false, error: `invalid_label:${raw}`, jevLatencyMs, attempts: attempt + 1 }
			}

			return {
				ok: true,
				label: answer.choice,
				confidence:
					typeof answer.confidence === 'number' && Number.isFinite(answer.confidence)
						? answer.confidence
						: 0,
				probabilities: normalizeProbabilities(answer.probabilities),
				jevLatencyMs,
				attempts: attempt + 1
			}
		} catch (error) {
			const jevLatencyMs = Math.round(performance.now() - startedAt)
			lastLatencyMs = jevLatencyMs
			const timedOut = error instanceof Error && error.name === 'AbortError'
			const reason = timedOut ? 'timeout' : 'network'
			// Timeouts and network errors are worth a retry; the free tier is
			// flaky under load and one dropped call shouldn't void a prompt.
			if (attempt < BENCH_MAX_RETRIES) {
				const waitMs = backoffMs(attempt)
				hooks.onWait?.(waitMs, attempt + 1, reason)
				await sleep(waitMs)
				continue
			}
			return { ok: false, error: reason, jevLatencyMs, attempts: attempt + 1 }
		} finally {
			clearTimeout(timer)
		}
	}

	return { ok: false, error: 'retries_exhausted', jevLatencyMs: lastLatencyMs, attempts: BENCH_MAX_RETRIES + 1 }
}

// Coerce one raw Jev answer into a validated JevAnswer. Jev's exact per-type
// fields aren't fully documented, so read defensively: keep a `choice` only
// when it's a string, a `score` only when finite, confidence as a finite number
// else 0, and probabilities filtered to finite numbers.
function normalizeAnswer(raw: {
	type?: string
	choice?: unknown
	score?: unknown
	confidence?: unknown
	probabilities?: unknown
}): JevAnswer {
	const probabilities: Record<string, number> | undefined =
		raw.probabilities && typeof raw.probabilities === 'object'
			? Object.fromEntries(
					Object.entries(raw.probabilities as Record<string, unknown>).filter(
						(entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])
					)
				)
			: undefined
	return {
		type: typeof raw.type === 'string' ? raw.type : 'unknown',
		choice: typeof raw.choice === 'string' ? raw.choice : undefined,
		score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : undefined,
		confidence:
			typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? raw.confidence : 0,
		probabilities
	}
}

/**
 * Ask Jev one or more arbitrary bounded questions in a SINGLE call (the AgentOS
 * Decision Bus path). Batching matters: the free tier bills `state` once per
 * call and throttles per call, so N decisions cost one hop, not N.
 *
 * Mirrors routeQueryMeasured's throttle discipline — retries 429/5xx honoring
 * Retry-After, retries timeout/network with backoff, and never falls back to a
 * default (the Decision Bus owns the policy fallback and must record whether a
 * decision was really Jev's). Only the successful hop is timed, so throttle
 * waits never inflate the measured decision latency. Never logs the API key.
 */
export async function askJev(
	state: string,
	questions: JevQuestions,
	hooks: ThrottleHooks = {}
): Promise<JevAskResult> {
	const body = JSON.stringify({
		reference: JEV_REFERENCE,
		input: { state, questions }
	})

	let lastLatencyMs = 0

	for (let attempt = 0; attempt <= BENCH_MAX_RETRIES; attempt++) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS)
		const startedAt = performance.now()

		try {
			const response = await fetch(JEV_RUN_URL, {
				method: 'POST',
				signal: controller.signal,
				headers: {
					Authorization: `Bearer ${env.BEATAPI_API_KEY}`,
					'Content-Type': 'application/json'
				},
				body
			})
			const latencyMs = Math.round(performance.now() - startedAt)
			lastLatencyMs = latencyMs

			if (response.status === 429 || response.status >= 500) {
				if (attempt < BENCH_MAX_RETRIES) {
					const waitMs = await retryAfterMs(response, attempt)
					hooks.onWait?.(waitMs, attempt + 1, `jev_http_${response.status}`)
					await sleep(waitMs)
					continue
				}
				return { ok: false, error: `jev_http_${response.status}`, latencyMs, attempts: attempt + 1 }
			}

			if (!response.ok) {
				// A 4xx other than 429 (e.g. a malformed question) won't be fixed
				// by retrying — fail fast so the Bus can fall back to policy.
				return { ok: false, error: `jev_http_${response.status}`, latencyMs, attempts: attempt + 1 }
			}

			const data = (await response.json()) as JevAskResponse
			const answers: Record<string, JevAnswer> = {}
			for (const [name, raw] of Object.entries(data.answers ?? {})) {
				answers[name] = normalizeAnswer(raw)
			}
			return { ok: true, answers, latencyMs, attempts: attempt + 1 }
		} catch (error) {
			const latencyMs = Math.round(performance.now() - startedAt)
			lastLatencyMs = latencyMs
			const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network'
			if (attempt < BENCH_MAX_RETRIES) {
				const waitMs = backoffMs(attempt)
				hooks.onWait?.(waitMs, attempt + 1, reason)
				await sleep(waitMs)
				continue
			}
			return { ok: false, error: reason, latencyMs, attempts: attempt + 1 }
		} finally {
			clearTimeout(timer)
		}
	}

	return { ok: false, error: 'retries_exhausted', latencyMs: lastLatencyMs, attempts: BENCH_MAX_RETRIES + 1 }
}
