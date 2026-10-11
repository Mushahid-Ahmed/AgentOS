import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { provisionUser } from '@/server/auth/provision-user'

// Supabase auth callback. Two shapes land here:
//   • ?code=…            — the PKCE flow (exchangeCodeForSession).
//   • ?token_hash=&type=… — an email confirmation / magic-link / recovery link.
// Both set the session cookie (a route handler CAN write cookies, unlike a Server
// Component), then we provision the User row (id = Supabase uuid) and send the
// user to the app. Anything else is rejected back to /login — never trust the
// redirect to an arbitrary target.

const OTP_TYPES: EmailOtpType[] = [
	'signup',
	'invite',
	'magiclink',
	'recovery',
	'email_change',
	'email'
]

export async function GET(request: NextRequest) {
	const { searchParams, origin } = new URL(request.url)
	const code = searchParams.get('code')
	const tokenHash = searchParams.get('token_hash')
	const type = searchParams.get('type')

	const supabase = await createServerSupabaseClient()
	const toLogin = (reason: string) =>
		NextResponse.redirect(new URL(`/login?error=${reason}`, origin))

	try {
		if (code) {
			const { error } = await supabase.auth.exchangeCodeForSession(code)
			if (error) return toLogin('callback_failed')
		} else if (tokenHash && type && (OTP_TYPES as string[]).includes(type)) {
			const { error } = await supabase.auth.verifyOtp({
				token_hash: tokenHash,
				type: type as EmailOtpType
			})
			if (error) return toLogin('callback_failed')
		} else {
			return toLogin('callback_invalid')
		}
	} catch {
		return toLogin('callback_failed')
	}

	// Session cookie is set; provision the caller's own User row from the server
	// session (never from the query string).
	const {
		data: { user }
	} = await supabase.auth.getUser()
	if (user?.email) {
		try {
			await provisionUser({ id: user.id, email: user.email })
		} catch {
			// Non-fatal: the session is valid, the profile upsert can be retried on
			// the next sign-in. Don't block the redirect.
		}
	}

	return NextResponse.redirect(new URL('/', origin))
}
