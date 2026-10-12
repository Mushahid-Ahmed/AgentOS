// Bounded, retried transport for the provider calls (AGENTOS_SCALE_SECURITY §2.4).
//
// Before this, nanogpt.ts called `fetch(NANOGPT_URL, …)` with no timeout and no
// retry. Two failure modes followed: a provider that accepted the connection and
// then stalled held an OpenAI-compatible request — and the serverless function and
// the user's SSE stream — open until the platform killed it, and a single 429 or 503
// (the ordinary shape of a rate-limited or shedding upstream) was handed to the user
// as a failure, with the credit-exhausting retries left to the client.
//
// The fetch implementation is injected so this is testable without a paid call: the
// tests hand it a fake that stalls, fails, and succeeds, and assert on the attempts.
// Pure except for that injection, which is why there is no `import 'server-only'`
// here, unlike its callers.

export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_RETRIES = 2

// 429 and the 5xx that mean "the request was not processed, ask again later".
// Deliberately excludes 4xx other than 429: a 400/401/402 will not change on retry,
// and re-sending a prompt that was rejected is how one bug becomes three.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

export function isRetryableStatus(status: number): boolean {
	return RETRYABLE_STATUS.has(status)
}

export type ProviderFetchInit = {
	method: 'POST'
	headers: Record<string, string>
	body: string
}

export async function providerFetch(
	url: string,
	makeInit: () => ProviderFetchInit,
	{
		timeoutMs = DEFAULT_TIMEOUT_MS,
		retries = DEFAULT_RETRIES,
		timeoutCovers = 'call',
		fetchImpl = fetch,
		sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
	}: {
		timeoutMs?: number
		retries?: number
		// `call` (the default) bounds the whole exchange, body read included — right for
		// a single-shot completion. `headers` bounds only the wait for the response to
		// start and releases the signal the moment it has, because a streaming caller
		// keeps reading that response for as long as the model talks: a live SSE stream
		// is not a stalled one, and a 30s cap on it would cut off long answers that work
		// today.
		timeoutCovers?: 'call' | 'headers'
		fetchImpl?: typeof fetch
		sleep?: (ms: number) => Promise<void>
	} = {}
): Promise<Response> {
	let lastError: unknown
	for (let attempt = 0; attempt <= retries; attempt++) {
		if (attempt > 0) await sleep(1_000 * 2 ** (attempt - 1))
		// A controller we own rather than AbortSignal.timeout(), because the `headers`
		// lifetime has to disarm on arrival — an armed timer would abort the body
		// mid-stream.
		const controller = new AbortController()
		const timer = setTimeout(
			() => controller.abort(new Error(`provider timeout after ${timeoutMs}ms`)),
			timeoutMs
		)
		// Never keep a process alive on a bookkeeping timer whose response is gone.
		timer.unref?.()
		try {
			const response = await fetchImpl(url, { ...makeInit(), signal: controller.signal })
			if (timeoutCovers === 'headers') clearTimeout(timer)
			if (!response.ok && isRetryableStatus(response.status) && attempt < retries) {
				// Release the error body's connection before the retry, or the pool
				// fills with sockets nobody read.
				await response.body?.cancel().catch(() => {})
				lastError = new Error(`provider returned ${response.status}`)
				continue
			}
			return response
		} catch (error) {
			clearTimeout(timer)
			lastError = error
			if (attempt === retries) break
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
