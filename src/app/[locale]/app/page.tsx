import type { Metadata } from 'next'
import { ChatWorkspace } from '@/components/chat/chat-workspace'

// The authenticated product entry. The marketing landing owns `/` now, so the
// chat workspace lives here; proxy.ts redirects signed-in visitors from `/`
// straight to this route.
export const metadata: Metadata = {
	title: 'Chat | AgentOS'
}

export default function AppPage() {
	return <ChatWorkspace />
}
