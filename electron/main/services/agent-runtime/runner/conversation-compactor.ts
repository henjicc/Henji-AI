import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { ModelStepMessage, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import {
  AGENT_KEEP_RECENT_TOKENS,
  compactConversationMessages,
  findRecentConversationStart,
} from '../context/compaction'
import { runSemanticCompaction, semanticSummaryMessage } from '../context/semantic-compaction'
import type { AgentSemanticSummary } from '../../../../../src/core/assistant/session'
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
  private overflowRecoveryUsed = false
  private previousSummary: AgentSemanticSummary | undefined
  private readonly keepRecentTokens: number

  constructor(private readonly options: AgentConversationCompactorOptions) {
    const contextWindow = options.model.limits.contextWindow
    const threshold = Math.max(1_000, Math.floor(contextWindow * 0.7))
    this.keepRecentTokens = Math.min(
      AGENT_KEEP_RECENT_TOKENS,
      Math.max(1_000, Math.floor(threshold * 0.5))
    )
  }

  beginOverflowRecovery(): boolean {
    if (this.overflowRecoveryUsed) return false
    this.overflowRecoveryUsed = true
    return true
  }

  async compact(turn: number, workingSummary?: AgentWorkingSummary): Promise<boolean> {
    let compactCount = findRecentConversationStart(
      this.options.conversation,
      this.keepRecentTokens
    )
    let splitRecent: ModelStepMessage[] = []
    const recent = this.options.conversation.slice(compactCount)
    const splitCandidate = compactConversationMessages(
      recent,
      this.keepRecentTokens,
      workingSummary
    )
    if (recent.length === 1 && splitCandidate.length > 1) {
      compactCount = this.options.conversation.length
      splitRecent = splitCandidate.slice(1)
    }
    if (compactCount <= 0) return false
    const coveredSequences = this.options.sourceSequences
      .slice(0, compactCount)
      .filter((sequence) => sequence > 0)
    const coveredThroughSequence = coveredSequences.length > 0
      ? Math.max(...coveredSequences)
      : undefined
    const requestId = `${this.options.runId}:summarizer:${turn}`
    this.options.setCurrentModelRequestId(requestId)
    try {
      const compacted = await runSemanticCompaction({
        runId: this.options.runId,
        turn,
        model: this.options.model,
        history: this.options.conversation.slice(0, compactCount),
        workingSummary,
        previousSummary: this.previousSummary,
        runModelStep: this.options.runModelStep,
        signal: this.options.signal,
      })
      this.options.throwIfCancelled()
      this.options.recordUsage(compacted.usage)
      this.options.conversation.splice(
        0,
        compactCount,
        semanticSummaryMessage(compacted.summary),
        ...splitRecent
      )
      this.options.sourceSequences.splice(
        0,
        compactCount,
        coveredThroughSequence ?? 0,
        ...splitRecent.map(() => 0)
      )
      this.previousSummary = compacted.summary
      const compactionEntry = coveredThroughSequence
        ? await this.options.appendSessionCompaction?.({
            runId: this.options.runId,
            threadId: this.options.threadId,
            turn,
            payload: {
              summary: compacted.summary,
              coveredFromSequence: Math.min(...coveredSequences),
              coveredThroughSequence,
              providerId: compacted.providerId,
              modelId: compacted.modelId,
              usage: compacted.usage,
              fallbackReason: null,
            },
          })
        : undefined
      if (compactionEntry) {
        this.options.sourceSequences[0] = compactionEntry.sequence
      }
      return true
    } catch {
      return false
    } finally {
      this.options.setCurrentModelRequestId(null)
    }
  }

  compactDeterministically(workingSummary?: AgentWorkingSummary): boolean {
    const historyLength = this.options.conversation.length
    if (historyLength <= 1) return false
    const compacted = compactConversationMessages(
      this.options.conversation.slice(0, historyLength),
      this.keepRecentTokens,
      workingSummary
    )
    if (compacted.length >= historyLength) return false
    this.options.conversation.splice(0, historyLength, ...compacted)
    this.options.sourceSequences.splice(
      0,
      historyLength,
      0,
      ...Array.from({ length: Math.max(0, compacted.length - 1) }, () => 0)
    )
    return true
  }
}
