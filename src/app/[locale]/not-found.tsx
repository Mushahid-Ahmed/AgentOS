import { Link } from '@/i18n/routing'
import { ErrorPage } from '@/components/error-page'
import { Button } from '@/components/ui/button'

export default function NotFound() {
	return (
		<ErrorPage
			code="404"
			kicker="Error 404"
			title="Page not found"
			description="The page you're looking for doesn't exist or may have moved."
			action={
				<Button asChild>
					<Link href="/">Go home</Link>
				</Button>
			}
		/>
	)
}
