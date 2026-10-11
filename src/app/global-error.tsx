'use client'

import { useEffect } from 'react'
import { captureClientError } from '@/lib/observability/capture-client-error'
import { isChunkLoadError, reloadOnceForChunkError } from '@/lib/errors/chunk-load-error'

// Replaces the ENTIRE app (including the [locale] root layout) when an
// error escapes even that layout, so it must render its own <html>/<body>
// and can't rely on globals.css having loaded — hence the inline styles and
// hardcoded colors below instead of Tailwind classes/design tokens. This is
// the one deliberate exception to "no hardcoded hex" in DESIGN.md; every
// other error UI goes through src/components/error-page.tsx and the real
// tokens. Values here are copied from the dark :root palette in
// src/app/globals.css (bg / surface / border / text / accent) — keep them in
// sync if those change.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
	useEffect(() => {
		if (isChunkLoadError(error)) {
			reloadOnceForChunkError()
			return
		}
		captureClientError(error, { digest: error.digest, boundary: 'global-error' })
	}, [error])

	if (isChunkLoadError(error)) return null

	return (
		<html>
			<body
				style={{
					margin: 0,
					backgroundColor: '#0a0a0b',
					color: '#f2f2f5',
					colorScheme: 'dark',
					fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif'
				}}
			>
				<div
					style={{
						display: 'flex',
						minHeight: '100vh',
						flexDirection: 'column',
						alignItems: 'center',
						justifyContent: 'center',
						gap: '1rem',
						padding: '1.5rem',
						textAlign: 'center'
					}}
				>
					<div
						style={{
							display: 'flex',
							maxWidth: '28rem',
							flexDirection: 'column',
							alignItems: 'center',
							gap: '1rem',
							borderRadius: '16px',
							border: '1px solid #26262c',
							backgroundColor: '#131316',
							boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.5)',
							padding: '2rem'
						}}
					>
						<h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0, color: '#f2f2f5' }}>
							Something went wrong
						</h1>
						<p style={{ fontSize: '0.875rem', color: '#b9b9c2', margin: 0 }}>
							We hit a snag loading the app. We&apos;ve been notified — reloading usually fixes it.
						</p>
						<button
							onClick={() => window.location.reload()}
							style={{
								borderRadius: '8px',
								backgroundColor: '#5b7cfa',
								color: '#0a0a0b',
								padding: '0.5rem 1rem',
								fontSize: '0.875rem',
								fontWeight: 500,
								border: 'none',
								cursor: 'pointer'
							}}
						>
							Reload
						</button>
						{error.digest && (
							<p style={{ fontSize: '0.75rem', color: '#8b8b96', margin: 0 }}>
								Reference: <code>{error.digest}</code>
							</p>
						)}
					</div>
				</div>
			</body>
		</html>
	)
}
