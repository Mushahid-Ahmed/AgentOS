import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from '@/i18n/routing'
import { apiGateDecision, gateDecision, stripLocale } from '@/lib/route-gate'
import type { AuthOnlySupabaseClient } from '@/lib/supabase/auth-only'

const intlProxy = createIntlMiddleware(routing)

// Refreshes the Supabase session cookie on every request, then gates the page (and,
// for /api/*, the data route) and hands off to next-intl's locale routing. Order
// matters: Supabase's cookie writes have to survive whatever we return next (redirect
// or rewrite), so we run Supabase first and copy its Set-Cookie headers onto the final
// response — not the other way around.
export default async function proxy(request: NextRequest) {
	let supabaseResponse = NextResponse.next({ request })
	let user: { id: string } | null = null

	const { pathname, search } = request.nextUrl
	// The Image Optimization endpoint is a Next built-in that this app never calls:
	// there is no `next/image` import and no `public/` directory anywhere in the tree,
	// yet the route is served and unauthenticated on every deployment. Its open
	// advisories (unauthenticated RCE through a crafted AVIF, GHSA-2xp9-vwfh-vxw4, and
	// SSRF, GHSA-cjq9-62q9-8jv4) are all fixed only by a `next` bump, so the surface
	// is closed here instead — a request to it cannot reach the optimizer at all.
	// Lift this if a real image component ever needs the optimizer.
	if (pathname === '/_next/image') {
		return NextResponse.json({ error: 'Not found' }, { status: 404 })
	}
	const isApi = pathname === '/api' || pathname.startsWith('/api/')
	// API routes are the hot path (every dashboard poll, every chat turn). getUser()
	// round-trips to Supabase's auth server on each call, which would add a network
	// hop per request per user at scale; the access token in the cookie is a JWT the
	// SDK has already expiry-checked locally, so getSession() is enough to answer
	// "is there a live session". Pages keep getUser() — they are the surface where a
	// revoked session has to be caught, and they are far rarer.
	const { NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabasePublishableKey } =
		process.env
	const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

	if (supabaseUrl && supabasePublishableKey) {
		// Typed to the auth surface like the wrappers in src/lib/supabase/ —
		// this is the one other place the SDK is constructed, and it exists
		// only to refresh the session cookie.
		const supabase: AuthOnlySupabaseClient = createServerClient(supabaseUrl, supabasePublishableKey, {
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
		})

		// Talking to Supabase here is a real network call — never let it take
		// the whole site down. If Supabase is unreachable the session just isn't
		// refreshed on this request; the gate below fails open (see note there).
		try {
			if (isApi) {
				const { data } = await supabase.auth.getSession()
				user = data.session ? { id: data.session.user.id } : null
			} else {
				const { data } = await supabase.auth.getUser()
				user = data.user
			}
		} catch {
			// Fail open — see comment above.
		}
	}

	const normalized = stripLocale(pathname, routing.locales)

	// API gate: deny before the handler ever runs, so a route cannot forget to check.
	if (isApi) {
		const decision = apiGateDecision({ normalized, hasUser: user !== null, configured: supabaseConfigured })
		if (decision.kind === 'unauthorized') {
			const denied = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
			supabaseResponse.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie))
			return denied
		}
		// Hand the verified identity to the handler as an internal request header, so
		// rate limiting and auditing can key on a user without a second cookie read per
		// request. Set, not appended: a client-forged `x-agentos-user-id` is overwritten
		// here, and with no session the header is removed rather than left forged. A
		// handler that sees the header can trust it because only this code writes it.
		const headers = new Headers(request.headers)
		if (user) headers.set('x-agentos-user-id', user.id)
		else headers.delete('x-agentos-user-id')
		const allowed = NextResponse.next({ request: { headers } })
		supabaseResponse.cookies.getAll().forEach((cookie) => allowed.cookies.set(cookie))
		return allowed
	}

	// Gate the page. Only enforced when Supabase is configured — with no auth env
	// vars the app must still serve (docs/rules/auth.md: it boots and serves 200s
	// with no Supabase configured), so we fail open rather than lock everyone out.
	// A transient getUser() failure leaves `user` null and would redirect to /login;
	// that is safe (login re-checks) and self-corrects on the next request.
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
	// Pages: skip static files and Next internals, locale routing applies to real
	// pages only. /api/* is listed separately because it needs the session check but
	// must never touch next-intl's rewrite. `/_next/image` is listed separately because
	// the general pattern excludes Next internals, and the image endpoint is the one
	// built-in we want to deny rather than serve (see the guard above).
	matcher: ['/((?!api|_next|_vercel|.*\\..*).*)', '/api/:path*', '/_next/image']
}
