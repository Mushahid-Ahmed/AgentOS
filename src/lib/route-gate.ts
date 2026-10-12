// Pure route-gate classification, split out of proxy.ts so the protection rules
// are unit-testable without constructing NextRequest/Supabase clients.

export function isPublicPath(normalized: string): boolean {
	return (
		normalized === '/' ||
		normalized === '/login' ||
		normalized === '/signup' ||
		normalized === '/auth/callback' ||
		normalized.startsWith('/auth/')
	)
}

// localePrefix is 'as-needed' and 'en' is the default (unprefixed), so canonical
// paths carry no prefix — but a hand-typed /en/... would. Strip a leading known
// locale so classification works either way.
export function stripLocale(pathname: string, locales: readonly string[]): string {
	const segment = pathname.split('/')[1]
	if (segment && locales.includes(segment)) {
		const rest = pathname.slice(segment.length + 1)
		return rest === '' ? '/' : rest
	}
	return pathname
}

export type GateDecision =
	| { kind: 'allow' }
	| { kind: 'login'; next: string }
	| { kind: 'app' }

// GET only. Server actions POST to the current page URL — e.g. the login form's
// provisionCurrentUser POSTs to /login *after* the session cookie is set.
// Redirecting that (authenticated user on /login -> /app) would 307 the POST, and
// a 307 preserves the method, so it becomes POST /app -> 405, breaking the action
// and stranding the form. Only gate document/RSC GETs.
export function gateDecision(input: {
	normalized: string
	pathname: string
	search: string
	hasUser: boolean
	configured: boolean
	isGet: boolean
}): GateDecision {
	if (!input.configured || !input.isGet) return { kind: 'allow' }
	if (!input.hasUser && !isPublicPath(input.normalized)) {
		return { kind: 'login', next: input.pathname + input.search }
	}
	if (input.hasUser && (input.normalized === '/login' || input.normalized === '/signup' || input.normalized === '/')) {
		// Signed-in visitors land straight in the product, not the marketing
		// landing or an auth form (brief 15.2).
		return { kind: 'app' }
	}
	return { kind: 'allow' }
}

// --- API surface ---------------------------------------------------------------
// Everything under /api is user data or user money: conversations, runs, spend, and
// the three POST routes that spend provider credits. There is no public API route in
// this app, so the list below is deliberately empty and the default is deny. Adding a
// genuinely public endpoint means adding it here *and* saying why in the comment —
// the reviewable seam is the point, not the length of the list.
const PUBLIC_API_PATHS: readonly string[] = []

export function isPublicApiPath(normalized: string): boolean {
	return PUBLIC_API_PATHS.includes(normalized)
}

export type ApiGateDecision = { kind: 'allow' } | { kind: 'unauthorized' }

// Unlike the page gate, a failure here is a 401 JSON body, never a redirect: an API
// client following a 307 to /login would re-POST its body to a page. The GET-only
// restriction that protects server actions does not apply — no API route is a form
// target.
//
// `configured` gates enforcement off when auth env vars are absent, which is the
// documented boot contract (docs/rules/auth.md: the app must serve with no Supabase).
// In that state there is no identity to check against and no data to protect, so the
// request proceeds; on any deployment that sets Supabase keys, a sessionless /api
// call is denied.
export function apiGateDecision(input: {
	normalized: string
	hasUser: boolean
	configured: boolean
}): ApiGateDecision {
	if (!input.configured) return { kind: 'allow' }
	if (isPublicApiPath(input.normalized)) return { kind: 'allow' }
	return input.hasUser ? { kind: 'allow' } : { kind: 'unauthorized' }
}

