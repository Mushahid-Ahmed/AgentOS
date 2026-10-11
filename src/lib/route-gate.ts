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
