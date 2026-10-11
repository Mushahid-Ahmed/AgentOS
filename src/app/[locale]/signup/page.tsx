import { Suspense } from 'react'
import type { Metadata } from 'next'
import { AuthForm } from '@/components/auth/auth-form'

export const metadata: Metadata = { title: 'Sign up — AgentOS' }

export default function SignupPage() {
	return (
		<Suspense>
			<AuthForm mode="signup" />
		</Suspense>
	)
}
