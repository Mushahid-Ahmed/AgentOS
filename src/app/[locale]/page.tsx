import type { Metadata } from 'next'
import { LandingPage } from '@/components/landing/landing-page'

// Public marketing landing (UI/UX run M4): content-rich, fifteen sections from
// preloader to footer. Signed-in visitors never see it: proxy.ts redirects
// them straight to /app.
export const metadata: Metadata = {
	title: 'AgentOS — Adaptive multi-agent intelligence',
	description:
		'AgentOS assembles a task-specific team of AI agents — researcher, critic, synthesizer — routed across models per step, backed by an auditable evidence hub.'
}

export default function HomePage() {
	return <LandingPage />
}
