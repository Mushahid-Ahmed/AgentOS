import 'server-only'
import type { ModelLabel } from '@/lib/models'
import type { AiProvider, TrackedModel } from '@/server/lib/ai-usage/models'

// The ai_usage ledger keys models by their short provider id (NANOGPT_SLUGS)
// and categorizes by provider. These maps translate each Jev/AgentOS model label
// to both. Defined ONCE here and shared by the chat pipeline
// (src/server/api/chat.ts) and the AgentOS agents (src/server/agents/) so a slug
// rename or a new label stays in a single place. The slug itself is resolved from
// the TrackedModel key by the sink, so this never hard-codes a NanoGPT id.
export const TRACKED_MODEL: Record<ModelLabel, TrackedModel> = {
	claude: 'claude-sonnet-4.5',
	gpt: 'gpt-4.1',
	gemini: 'gemini-2.5-flash'
}

export const PROVIDER: Record<ModelLabel, AiProvider> = {
	claude: 'anthropic',
	gpt: 'openai',
	gemini: 'google'
}
