import { AppHeader } from '@/components/nav/app-header'
import { AnalyticsDemoClient } from './analytics-demo-client'

// Reference page for the analytics taxonomy (docs/rules/analytics.md). It's a
// living example, not product — delete this whole folder once you've read it.
// Take 3 M6: it's still a URL a signed-in person can reach, so it wears the
// product shell (AppHeader + the shared masthead voice) instead of looking
// like a different app.
export default function AnalyticsDemoPage() {
	return (
		<div className="bg-bg text-text flex min-h-dvh flex-col">
			<AppHeader title="Analytics demo" subtitle="instrumentation reference · not product" />
			<main
				id="main-content"
				tabIndex={-1}
				className="relative flex-1 overflow-y-auto px-6 py-10"
			>
				<div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
					<section
						aria-label="About this page"
						className="panel-in relative overflow-hidden"
					>
						<div className="app-aurora" aria-hidden="true" />
						<p className="label-uppercase text-text-faint relative">AgentOS · event catalog</p>
						{/* <h2>: the demo's card titles are <h3>, so the masthead has to
						    occupy level two or axe flags a skipped heading level. */}
						<h2 className="app-masthead text-text relative mt-2">Every click, measured.</h2>
					</section>
					<AnalyticsDemoClient />
				</div>
			</main>
		</div>
	)
}
