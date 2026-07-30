import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { ModelStepMessage, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import { compactConversationMessages } from '../context/compaction'
import { runSemanticCompaction, semanticSummaryMessage } from '../context/semantic-compaction'
import type { AgentRuntimeModel } from './models'
import type { AgentModelStepExecutor, AgentRunnerDependencies } from './types'

interface AgentConversationCompactorOptions {
  runId: string
  threadId: string
  model: AgentRuntimeModel
  conversation: ModelStepMessage[]
  sourceSequences: number[]
  runModelStep: AgentModelStepExecutor
  signal: AbortSignal
  appendSessionCompaction?: AgentRunnerDependencies['appendSessionCompaction']
  recordUsage: (usage: ModelStepResult['usage']) => void
  setCurrentModelRequestId: (requestId: string | null) => void
  throwIfCancelled: () => void
}

export class AgentConversationCompactor {
  private persistentHistoryLength: number
  private semanticCompactionAttempted = false
  private overflowRecoveryUsed = false

  constructor(private readonly options: AgentConversationCompactorOptions) {
    this.persistentHistoryLength = options.conversation.length
  }

  beginOverflowRecovery(): boolean {
    if (this.overflowRecoveryUsed) return false
    this.overflowRecoveryUsed = true
    return true
  }

  async compact(turn: number, workingSummary?: AgentWorkingSummary): Promise<boolean> {
    const recentCount = Math.min(6, this.persistentHistoryLength)
    const compactCount = this.persistentHistoryLength - recentCount
    if (this.semanticCompactionAttempted || compactCount <= 0) return false
    this.semanticCompactionAttempted = true
    const coveredThroughSequence = this.options.sourceSequences[compactCount - 1]
    if (!coveredThroughSequence) return false
    const requestId = `${this.options.runId}:summarizer:${turn}`
    this.options.setCurrentModelRequestId(requestId)
    try {
      const compacted = await runSemanticCompaction({
        runId: this.options.runId,
        turn,
        model: this.options.model,
        history: this.options.conversation.slice(0, compactCount),
        workingSummary,
        runModelStep: this.options.runModelStep,
        signal: this.options.signal,
      })
      this.options.throwIfCancelled()
      this.options.recordUsage(compacted.usage)
      this.options.conversation.splice(0, compactCount, semanticSummaryMessage(compacted.summary))
      this.persistentHistoryLength = recentCount + 1
      await this.options.appendSessionCompaction?.({
        runId: this.options.runId,
        threadId: this.options.threadId,
        turn,
        payload: {
          summary: compacted.summary,
          coveredFromSequence: 1,
          coveredThroughSequence,
          providerId: compacted.providerId,
          modelId: compacted.modelId,
          usage: compacted.usage,
          fallbackReason: null,
        },
      })
      return true
    } catch {
      return false
    } finally {
      this.options.setCurrentModelRequestId(null)
    }
  }

  compactDeterministically(workingSummary?: AgentWorkingSummary): boolean {
    if (this.persistentHistoryLength <= 4) return false
    const compacted = compactConversationMessages(
      this.options.conversation.slice(0, this.persistentHistoryLength),
      4,
      workingSummary
    )
    this.options.conversation.splice(0, this.persistentHistoryLength, ...compacted)
    this.persistentHistoryLength = compacted.length
    return true
  }
}
