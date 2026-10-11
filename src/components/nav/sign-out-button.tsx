'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/routing'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'
import { Button } from '@/components/ui/button'

// Ends the Supabase session in the browser, then returns to /login. The proxy
// gate would bounce any protected page to /login anyway; the explicit replace +
// refresh makes it immediate and clears the signed-in UI.
export function SignOutButton() {
	const router = useRouter()
	const [pending, setPending] = useState(false)

	async function signOut() {
		if (pending) return
		setPending(true)
		const supabase = createBrowserSupabaseClient()
		await supabase.auth.signOut()
		router.replace('/login')
		router.refresh()
	}

	return (
		<Button variant="ghost" size="sm" className="max-md:h-11" onClick={signOut} disabled={pending}>
			{pending ? 'Signing out…' : 'Sign out'}
		</Button>
	)
}
