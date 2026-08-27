import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { ModelStepResult } from '@henjicc/ai-sdk'
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
  let compactionAttempted = false
  try {
    result = await input.modelTurns.runPrimary(input.turn, context)
  } catch (error) {
    if (
      isContextOverflowError(error)
      && input.currentToolCallId === null
      && input.workingSummary?.recovery.mode !== 'verify_before_write'
      && input.compactor.beginOverflowRecovery()
    ) {
      compactionAttempted = true
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
      // 走没走过压缩必须分开报。旧实现两条路共用一句"压缩后仍超限"，于是"恢复闸门被拒"
      // 的情况也说成压缩失败，排查的人会去查压缩算法，而真正的原因在闸门条件上。
      throw new Error(compactionAttempted
        ? '[CONTEXT_OVERFLOW_AFTER_COMPACTION] 上下文压缩后仍超过模型限制，运行已停止'
        : '[CONTEXT_OVERFLOW_NOT_RECOVERABLE] 上下文超过模型限制，且当前状态不允许压缩重试'
          + `（工具调用进行中=${input.currentToolCallId !== null}`
          + `，恢复模式=${input.workingSummary?.recovery.mode ?? '无'}`
          + '，或历史自上次压缩后没有变化），运行已停止')
    }
    throw modelError ?? new Error('[MODEL_STEP_EMPTY] 模型步骤未返回结果')
  }
  return { context, result }
}
