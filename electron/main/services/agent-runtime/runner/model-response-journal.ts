import type { ModelStepResult } from '../../../../../src/core/llm/modelStep'
import type { AgentRunMetrics } from './budget'
import type { AgentConversationJournal } from './conversation-journal'
import type { AgentModelOutputGuard } from './model-output-guard'

export async function persistValidatedModelResponse(input: {
  result: ModelStepResult
  guard: AgentModelOutputGuard
  budget: AgentRunMetrics
  journal: AgentConversationJournal
}): Promise<boolean> {
  if (!input.guard.accept(input.result)) {
    input.budget.recordFailure()
    await input.journal.flush()
    return false
  }
  for (const [index, message] of input.result.responseMessages.entries()) {
    input.journal.appendInternal(
      'model_message',
      message,
      `model:${input.result.stepId}:${index}`,
      {
        providerId: input.result.providerId,
        modelId: input.result.modelId,
        stepId: input.result.stepId,
        finishReason: input.result.finishReason,
        usage: input.result.usage,
      }
    )
  }
  await input.journal.flush()
  return true
}
