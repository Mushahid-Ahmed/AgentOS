import type { Metadata } from 'next'
import { LandingPage } from '@/components/landing/landing-page'

// Public marketing landing (UI/UX run M4): content-rich, fifteen sections from
// preloader to footer. Signed-in visitors never see it: proxy.ts redirects
// them straight to /app.
export const metadata: Metadata = {
	title: 'AgentOS | Adaptive multi-agent intelligence',
	description:
		'AgentOS assembles a task-specific team of AI agents (researcher, critic, synthesizer), routed across models per step, backed by an auditable evidence hub.'
}

// The benchmark table and the Decision Bus log are read from the database (V14 M2), so
// the page renders server-side rather than from literals baked into the source. It is
// cached for five minutes: the marketing numbers move when a run is stored, not per
// request, and the cache keeps the first paint as fast as the static page it replaced.
export const revalidate = 300

export default function HomePage() {
	return <LandingPage />
}
