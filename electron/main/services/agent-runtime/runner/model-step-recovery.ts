import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { ModelStepResult } from '../../../../../src/core/llm/modelStep'
import type { AgentContextBuildResult } from '../context/types'
import { isContextOverflowError } from '../context/semantic-compaction'
import type { AgentConversationCompactor } from './conversation-compactor'
import type { AgentModelTurnCoordinator } from './model-turn-coordinator'

interface PrimaryStepRecoveryInput {
  turn: number
  context: AgentContextBuildResult
  rebuild: () => AgentContextBuildResult
  modelTurns: AgentModelTurnCoordinator
  compactor: AgentConversationCompactor
  workingSummary?: AgentWorkingSummary
  currentToolCallId: string | null
  clearCurrentRequest: () => void
  throwIfCancelled: () => void
}

export async function runPrimaryStepWithOverflowRecovery(
  input: PrimaryStepRecoveryInput
): Promise<{ context: AgentContextBuildResult; result: ModelStepResult }> {
  let context = input.context
  let result: ModelStepResult | null = null
  let modelError: unknown | null = null
  try {
    result = await input.modelTurns.runPrimary(input.turn, context)
  } catch (error) {
    if (
      isContextOverflowError(error)
      && input.currentToolCallId === null
      && input.workingSummary?.recovery.mode !== 'verify_before_write'
      && input.compactor.beginOverflowRecovery()
    ) {
      const compacted = await input.compactor.compact(input.turn, input.workingSummary)
      if (!compacted) input.compactor.compactDeterministically(input.workingSummary)
      context = input.rebuild()
      try {
        result = await input.modelTurns.runPrimary(input.turn, context, 'overflow-retry')
      } catch (retryError) {
        modelError = retryError
      }
    } else {
      modelError = error
    }
  }
  if (modelError || !result) {
    input.clearCurrentRequest()
    input.throwIfCancelled()
    if (isContextOverflowError(modelError)) {
      throw new Error('[CONTEXT_OVERFLOW_AFTER_COMPACTION] 上下文压缩后仍超过模型限制，运行已停止')
    }
    throw modelError ?? new Error('[MODEL_STEP_EMPTY] 模型步骤未返回结果')
  }
  return { context, result }
}
