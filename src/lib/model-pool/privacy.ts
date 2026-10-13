// Model Pool privacy guard (M6 privacy, pure so it ships with the core) — brief
// §PRIVACY AND SAFETY: free models can log prompts or train on them depending on
// provider policy, so obviously-sensitive content (API keys, tokens, passwords,
// private keys, connection strings) must NEVER be sent to a free model. This is the
// light guard: it detects secret-shaped substrings and tells the caller to route the
// content to a premium model or refuse. It is deliberately conservative (false
// positives are acceptable — better to route to premium than leak a key) and it NEVER
// returns the secret itself, only a masked prefix + kind, so a log line or an event
// built from a match cannot leak the value.
//
// This does not replace keeping secrets server-side; it is a last-line filter on the
// prompt text right before a free-tier call.

import type { ModelTier } from './types'

export type SecretKind =
	| 'anthropic-key'
	| 'openai-key'
	| 'generic-secret-key'
	| 'github-token'
	| 'slack-token'
	| 'google-api-key'
	| 'aws-access-key'
	| 'jwt'
	| 'private-key-block'
	| 'db-connection-string'
	| 'bearer-token'
	| 'password-assignment'
	| 'supabase-secret-key'

export type SecretMatch = {
	kind: SecretKind
	// Masked: a short prefix + length only. NEVER the full value.
	masked: string
	index: number
}

// Order matters only for masking overlap; each pattern is applied independently.
// Patterns are intentionally broad (the guard errs toward routing to premium).
const PATTERNS: Array<{ kind: SecretKind; re: RegExp }> = [
	{ kind: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
	{ kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{10,}/g },
	{ kind: 'openai-key', re: /\bsk-proj-[A-Za-z0-9_-]{10,}/g },
	{
		kind: 'github-token',
		re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}/g
	},
	{ kind: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
	{ kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{20,}/g },
	{ kind: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{12,}\b/g },
	{ kind: 'supabase-secret-key', re: /\bsb_secret_[A-Za-z0-9._-]{10,}/g },
	// NanoGPT (the V3 aggregator) issues plain `sk-…` keys with no distinctive
	// provider prefix, so they land here rather than in a dedicated kind. Listed
	// after the provider-specific `sk-ant-`/`sk-proj-` patterns so a key that DOES
	// carry a known prefix is classified precisely first.
	{ kind: 'generic-secret-key', re: /\bsk-[A-Za-z0-9_-]{16,}/g },
	{ kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
	{
		kind: 'db-connection-string',
		re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/g
	},
	{ kind: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g },
	{
		kind: 'password-assignment',
		re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"]?[^\s'"]{6,}/gi
	}
]

// Mask a matched secret to a short prefix + length. The prefix is capped at 4 chars
// (enough to recognise "sk-a…" / "AKIA…" without exposing the value).
function mask(value: string): string {
	const prefix = value.slice(0, 4)
	return `${prefix}…(${value.length} chars)`
}

// Detect secret-shaped substrings. Returns masked matches (never raw secrets).
export function detectSecrets(text: string): SecretMatch[] {
	if (typeof text !== 'string' || text === '') return []
	const matches: SecretMatch[] = []
	for (const { kind, re } of PATTERNS) {
		// Reset lastIndex per pattern (the regexes are /g and reused across calls).
		re.lastIndex = 0
		let m: RegExpExecArray | null
		while ((m = re.exec(text)) !== null) {
			matches.push({ kind, masked: mask(m[0]), index: m.index })
			// Guard against a zero-length match looping forever.
			if (m.index === re.lastIndex) re.lastIndex++
		}
	}
	return matches.sort((a, b) => a.index - b.index)
}

export function containsSecrets(text: string): boolean {
	return detectSecrets(text).length > 0
}

export type GuardDecision = {
	// Whether the content may be sent to the requested tier as-is.
	allowed: boolean
	// What the caller should do: send it, or route the step to a premium model.
	// 'refuse' is the caller's fallback when no premium model is available.
	action: 'send' | 'route-premium'
	matches: SecretMatch[]
	reason: string
}

// Decide whether `text` may go to a model of `tier`. Free tier + any detected secret
// -> not allowed, route to premium. Premium tier is allowed (the brief routes
// sensitive content to premium, which is not prompt-logged/trained by our settings),
// but we still surface the matches so the caller can log that secrets were present
// (masked) and avoid echoing them.
export function guardForTier(text: string, tier: ModelTier): GuardDecision {
	const matches = detectSecrets(text)
	if (matches.length === 0) {
		return { allowed: true, action: 'send', matches, reason: 'no secret-shaped content detected' }
	}
	if (tier === 'free') {
		const kinds = [...new Set(matches.map((m) => m.kind))].join(', ')
		return {
			allowed: false,
			action: 'route-premium',
			matches,
			reason: `secret-shaped content (${kinds}) must not be sent to a free model. Route to premium or refuse.`
		}
	}
	return {
		allowed: true,
		action: 'send',
		matches,
		reason:
			'secret-shaped content present but tier is premium (not prompt-logged/trained per account policy)'
	}
}
