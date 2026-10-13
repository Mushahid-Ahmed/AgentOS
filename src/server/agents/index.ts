import 'server-only'
import { isModelLabel } from '@/lib/models'
import type { AgentRegistry, ModelRegistry } from '@/lib/orchestra/types'
import { createGeneratingAgent } from './generating-agent'
import { createCodeAgent } from './code-agent'
import { createResearcherAgent } from './researcher'
import { createCriticAgent } from './critic'

// The agent registry. M3 made the two generating roles real (answerer, synthesizer);
// M4 added `code` (the keyless calculator); M5 adds `researcher` (research tool +
// the evidence hub) and `critic` (the Skeptic/Fact-Checker). With all five roles
// registered, the Decision Bus can select any team and the plan builder defers
// nothing — every role Jev routes to now has a real implementation.
export const AGENT_REGISTRY: AgentRegistry = {
	answerer: createGeneratingAgent('answerer', {
		feature: 'agentos_answerer',
		systemPrompt:
			'You are a helpful assistant inside AgentOS, an adaptive multi-agent system. Answer the user query directly and concisely. Use Markdown; put code in fenced blocks with a language. Do not invent facts; if you are unsure, say so.'
	}),
	researcher: createResearcherAgent(),
	code: createCodeAgent({ feature: 'agentos_code' }),
	critic: createCriticAgent({ feature: 'agentos_critic' }),
	synthesizer: createGeneratingAgent('synthesizer', {
		feature: 'agentos_synthesizer',
		systemPrompt:
			'You are the Final Synthesizer inside AgentOS. Combine the worker findings into one clear, well-structured answer to the user query. Use ONLY the worker findings and your own clearly-marked general knowledge; if a needed fact has no supporting finding, state that it is unverified rather than inventing it. When a worker finding reports an exact calculated value, use that value verbatim; do not recompute it. When findings include source URLs, cite them. Use Markdown; put code in fenced blocks with a language.'
	})
}

// The model registry the plan validator checks step.model against. AgentOS routes
// to the three Jev labels, so a step model is valid exactly when it is one of
// claude|gpt|gemini.
export const MODEL_REGISTRY: ModelRegistry = {
	has: (model: string) => isModelLabel(model)
}

// The role names this registry can actually execute — handed to buildAgentPlan so
// it defers (rather than emits) steps for roles Jev selected but this build lacks.
export const REGISTERED_ROLES: readonly string[] = Object.keys(AGENT_REGISTRY)
