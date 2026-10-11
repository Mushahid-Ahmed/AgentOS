'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { provisionUser } from '@/server/auth/provision-user'

// Provisions the caller's own User row (id = Supabase auth uuid) after a
// password sign-in / sign-up. The identity is read from the SERVER session, never
// from client-supplied arguments — docs/rules/auth.md authorization rule 3: never
// scope a write by a client-supplied id alone. Idempotent (provisionUser upserts),
// so it is safe to call on every sign-in. Returns a plain result rather than
// throwing so the client form can surface a non-fatal warning without a redirect
// loop — the session is already valid even if this write fails.
export async function provisionCurrentUser(): Promise<{ ok: true } | { ok: false; error: string }> {
	try {
		const supabase = await createServerSupabaseClient()
		const {
			data: { user }
		} = await supabase.auth.getUser()

		if (!user?.email) {
			return { ok: false, error: 'no_session' }
		}

		await provisionUser({ id: user.id, email: user.email })
		return { ok: true }
	} catch {
		// The user is authenticated regardless; a failed profile upsert must not
		// lock them out. Never reject — the client treats provisioning as
		// best-effort and proceeds with the redirect.
		return { ok: false, error: 'provision_failed' }
	}
}
