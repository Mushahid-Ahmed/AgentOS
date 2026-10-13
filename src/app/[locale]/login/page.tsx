import { Suspense } from 'react'
import type { Metadata } from 'next'
import { AuthForm } from '@/components/auth/auth-form'

export const metadata: Metadata = { title: 'Log in | AgentOS' }

// The proxy gates every page route, so an unauthenticated visitor always lands
// here. Suspense wraps the form because it reads ?next= via useSearchParams.
export default function LoginPage() {
	return (
		<Suspense>
			<AuthForm mode="login" />
		</Suspense>
	)
}
