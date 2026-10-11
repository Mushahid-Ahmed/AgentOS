import { AgentOSView } from '@/components/agentos/run-view'

// Milestone 7: the AgentOS run view (mockup D6) — a third view alongside chat and
// the dashboard. Renders the live SSE run and replays persisted runs through the
// one pure reducer. Strings are hardcoded English for now, matching the dashboard;
// next-intl extraction is deferred to the polish milestone.
export default function AgentOSPage() {
	return <AgentOSView />
}
