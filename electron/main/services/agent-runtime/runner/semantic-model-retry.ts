import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import {
  isAgentSemanticRetryable,
  parseModelProviderError,
} from '../../../../../src/core/llm/providerProtocol'
import type { AgentBudgetTracker } from './budget'
import { errorCode } from './runner-results'

export function prepareSemanticModelRetry(
  error: unknown,
  budget: AgentBudgetTracker,
  stepId: string
): { event: AgentEventInput; code: string } {
  if (!isAgentSemanticRetryable(error)) throw error
  budget.recordFailure()
  const providerError = parseModelProviderError(error)
  const code = providerError?.code ?? errorCode(error)
  return {
    code,
    event: {
      type: 'ModelRetrying',
      stepId,
      layer: 'semantic',
      attempt: budget.snapshot().consecutiveFailures,
      delayMs: 0,
      category: providerError?.category ?? 'unknown',
      code,
    },
  }
}
