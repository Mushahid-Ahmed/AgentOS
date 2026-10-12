import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// One CSP for the whole app. `connect-src` is the only origin-bearing directive
// that needs new entries when a service is added: it lists exactly the hosts the
// browser is allowed to talk to (self, Supabase auth/realtime, PostHog, Sentry
// ingest) and nothing else, so an injected script has nowhere to exfiltrate to.
// `unsafe-inline` survives in script-src because Next.js injects the bootstrap
// payload inline; it is paired with `strict-dynamic`-free, nonce-less shipping,
// so removing it would require a per-request nonce across the App Router.
const CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' 'report-sample'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.posthog.com https://*.ingest.sentry.io",
	"worker-src 'self' blob:",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"frame-src 'self' https://*.supabase.co",
	'upgrade-insecure-requests'
].join('; ')

// Defense-in-depth on top of `frame-ancestors`, for anything that predates CSP
// support in the requesting context. HSTS is emitted by Vercel at the edge too;
// declaring it here keeps the app correct on any other origin.
const SECURITY_HEADERS = [
	{ key: 'X-Frame-Options', value: 'DENY' },
	{ key: 'X-Content-Type-Options', value: 'nosniff' },
	{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
	{ key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
	{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
	{ key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
	{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
	{ key: 'Content-Security-Policy', value: CSP }
]

const nextConfig: NextConfig = {
	// A measurement build can set NEXT_DIST_DIR to write a throwaway tree instead of
	// replacing the `.next` that the owner's running dev server is reading. Unset,
	// this is exactly the default.
	distDir: process.env.NEXT_DIST_DIR || '.next',
	reactStrictMode: true,
	async headers() {
		return [
			{ source: '/(.*)', headers: SECURITY_HEADERS },
			// The read-only dashboard feeds are per-user aggregates, so they are
			// `private` — a `public` cache here would serve one user's spend to
			// another. Short TTL + SWR still collapses the repeat-request traffic
			// a dashboard panel generates.
			{
				source: '/api/(dashboard|spend|model-pool)',
				headers: [{ key: 'Cache-Control', value: 'private, max-age=15, stale-while-revalidate=60' }]
			}
		]
	},
	// Top-level as of Next.js 16, not under `experimental`. Strictest
	// setting: any Compiler bailout fails the build instead of silently
	// skipping optimization for that component. Matches 8x-core and
	// 8x-brands — catch Compiler-incompatible code at build time, not as a
	// silent perf regression in prod.
	reactCompiler: {
		panicThreshold: 'all_errors'
	}
}

export default withSentryConfig(withNextIntl(nextConfig), {
	org: process.env.SENTRY_ORG,
	project: process.env.SENTRY_PROJECT,
	silent: !process.env.CI,
	widenClientFileUpload: true
	// disableLogger is deprecated and unsupported under Turbopack (our
	// default bundler) — Sentry's tree-shaking of its own debug logging
	// happens automatically now, nothing to configure here.
})
