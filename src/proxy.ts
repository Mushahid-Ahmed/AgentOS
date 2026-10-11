import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from '@/i18n/routing'
import { gateDecision, stripLocale } from '@/lib/route-gate'
import type { AuthOnlySupabaseClient } from '@/lib/supabase/auth-only'

const intlProxy = createIntlMiddleware(routing)

// Refreshes the Supabase session cookie on every request, then gates the page and
// hands off to next-intl's locale routing. Order matters: Supabase's cookie writes
// have to survive whatever we return next (redirect or rewrite), so we run Supabase
// first and copy its Set-Cookie headers onto the final response — not the other way
// around.
export default async function proxy(request: NextRequest) {
	let supabaseResponse = NextResponse.next({ request })
	let user: { id: string } | null = null

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
	const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
	const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

	if (supabaseUrl && supabasePublishableKey) {
		// Typed to the auth surface like the wrappers in src/lib/supabase/ —
		// this is the one other place the SDK is constructed, and it exists
		// only to refresh the session cookie.
		const supabase: AuthOnlySupabaseClient = createServerClient(
			supabaseUrl,
			supabasePublishableKey,
			{
				cookies: {
					getAll() {
						return request.cookies.getAll()
					},
					setAll(cookiesToSet) {
						cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
						supabaseResponse = NextResponse.next({ request })
						cookiesToSet.forEach(({ name, value, options }) =>
							supabaseResponse.cookies.set(name, value, options)
						)
					}
				}
			}
		)

		// Talking to Supabase here is a real network call — never let it take
		// the whole site down. If Supabase is unreachable the session just isn't
		// refreshed on this request; the gate below fails open (see note there).
		try {
			const { data } = await supabase.auth.getUser()
			user = data.user
		} catch {
			// Fail open — see comment above.
		}
	}

	// Gate the page. Only enforced when Supabase is configured — with no auth env
	// vars the app must still serve (docs/rules/auth.md: it boots and serves 200s
	// with no Supabase configured), so we fail open rather than lock everyone out.
	// A transient getUser() failure leaves `user` null and would redirect to /login;
	// that is safe (login re-checks) and self-corrects on the next request.
	const { pathname, search } = request.nextUrl
	const normalized = stripLocale(pathname, routing.locales)
	let redirectResponse: NextResponse | null = null

	// The GET-only / fail-open rationale lives with gateDecision in
	// @/lib/route-gate (unit-tested there).
	const decision = gateDecision({
		normalized,
		pathname,
		search,
		hasUser: user !== null,
		configured: supabaseConfigured,
		isGet: request.method === 'GET'
	})
	if (decision.kind === 'login') {
		const loginUrl = new URL('/login', request.url)
		loginUrl.searchParams.set('next', decision.next)
		redirectResponse = NextResponse.redirect(loginUrl)
	} else if (decision.kind === 'app') {
		redirectResponse = NextResponse.redirect(new URL('/app', request.url))
	}

	const finalResponse = redirectResponse ?? intlProxy(request)
	// Copy the whole cookie object, not just (name, value): the options carry
	// httpOnly / secure / sameSite / maxAge / path, and dropping them would
	// downgrade a freshly refreshed session cookie into a permissive one.
	supabaseResponse.cookies.getAll().forEach((cookie) => {
		finalResponse.cookies.set(cookie)
	})

	return finalResponse
}

export const config = {
	// Skip API routes, static files, and Next internals — locale routing
	// only applies to actual pages.
	matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
}
