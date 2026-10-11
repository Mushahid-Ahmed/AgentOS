#!/usr/bin/env node
// Checks this project's model map against the curated NanoGPT price table and,
// when reachable, NanoGPT's live catalogue.
//
// This is the direction TypeScript cannot catch. `TrackedModel` in
// src/server/lib/ai-usage/models.ts already makes an unmapped SHORT provider id a
// typecheck failure at the call site; what it cannot see is a slug that was correct
// when it was written and has since been retired upstream, or a map value that no
// longer has a curated price. Either way the row silently prices NULL.
//
// Two checks, cheapest first:
//  1. LOCAL (no network): every mapped slug must be present in the curated rate
//     card (built from NANOGPT_CATALOG in src/lib/models.ts). A mapped slug absent
//     from the catalog prices NULL — that is a bug in the map or the catalog, and
//     it fails hard because it needs no network to detect.
//  2. LIVE (network, best-effort): the slug must still be listed by NanoGPT's
//     public catalogue. A network blip must not turn every PR red, so an
//     unreachable catalogue skips this half (exit 0); only a slug upstream has
//     actually retired fails.
//
// Scope limit (D-36): this only checks the compile-time `NANOGPT_SLUGS` map. The
// Model Pool also passes already-canonical slugs straight through `trackAiCall`
// without a map entry; those runtime-discovered slugs are deliberately NOT covered
// here — the pool verifies each with a real probe, and an untrusted slug prices
// NULL (never $0) at write time.
//
// Usage: node --import ./scripts/register-ts.mjs scripts/check-ai-models.mjs
//
// Exit codes: 0 clean (or upstream unreachable), 1 a mapped slug is unpriced or gone.

import { rateCard } from '../src/server/lib/ai-usage/pricing.ts'
import { NANOGPT_SLUGS } from '../src/server/lib/ai-usage/models.ts'

const NANOGPT_MODELS_URL = 'https://api.nano-gpt.com/v1/models?detailed=true'

const mapped = Object.entries(NANOGPT_SLUGS)

if (mapped.length === 0) {
	console.log('No models mapped — nothing to check. (A project with no AI calls is fine here.)')
	process.exit(0)
}

// --- 1. Local invariant: every mapped slug has a curated price ----------------
// No network, no key. This is the load-bearing half — a mapped slug that is not a
// NANOGPT_CATALOG key prices NULL, which is exactly the silent-$0 rot this guards.
const rates = rateCard()
const unpriced = mapped.filter(([, slug]) => !rates.has(slug))

if (unpriced.length > 0) {
	console.error(
		`${unpriced.length} mapped slug(s) have no curated price in NANOGPT_CATALOG ` +
			`(src/lib/models.ts). Every call to these models is recorded unpriced:\n`
	)
	for (const [model, slug] of unpriced) {
		console.error(`  ${model}  ->  ${slug}`)
	}
	console.error(
		`\nAdd each slug to NANOGPT_CATALOG with its verified per-1M USD price, or fix the ` +
			`mapping in src/server/lib/ai-usage/models.ts.`
	)
	process.exit(1)
}

// --- 2. Live check: the slug is still listed upstream (best-effort) -----------
let liveIds
try {
	const res = await fetch(NANOGPT_MODELS_URL)
	if (!res.ok) throw new Error(`NanoGPT models ${res.status}`)
	const body = await res.json()
	liveIds = new Set((body?.data ?? []).map((m) => m?.id).filter((x) => typeof x === 'string'))
} catch (error) {
	// Deliberately not a failure. A network blip upstream must not turn every PR in
	// every repo red; the local price invariant above already passed.
	console.warn(`Could not reach NanoGPT, skipping the live check: ${error.message}`)
	console.log(`All ${mapped.length} mapped model(s) have a curated price.`)
	process.exit(0)
}

const retired = mapped.filter(([, slug]) => !liveIds.has(slug))

if (retired.length > 0) {
	console.error(
		`NanoGPT no longer lists ${retired.length} mapped slug(s). Until they are updated ` +
			`in src/server/lib/ai-usage/models.ts, every call to these models is recorded ` +
			`unpriced:\n`
	)
	for (const [model, slug] of retired) {
		console.error(`  ${model}  ->  ${slug}`)
	}
	console.error(
		`\nFind the current slug at ${NANOGPT_MODELS_URL} — it is the "id" field that belongs ` +
			`in the map, and NanoGPT ids are NOT uniformly publisher-prefixed.`
	)
	process.exit(1)
}

console.log(`All ${mapped.length} mapped model(s) are curated AND still listed by NanoGPT.`)
