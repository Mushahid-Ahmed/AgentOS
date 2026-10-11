import { createBrowserClient } from '@supabase/ssr'
import type { AuthOnlySupabaseClient } from './auth-only'

// Browser-side Supabase client for the login/signup forms. Auth only, like the
// server wrappers — the return type is the auth surface and nothing else, so a
// `.from()` here is a compile error (docs/rules/auth.md). Application data goes
// through Prisma on the server, never from the browser. This file is one of the
// two places the SDK may be imported (the other is proxy.ts); the eslint
// boundary in eslint.config.mjs enforces that.
export function createBrowserSupabaseClient(): AuthOnlySupabaseClient {
	return createBrowserClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
	)
}
