import { createMainLogger } from '../../logging'
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

const logger = createMainLogger('main.agent_runtime')

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
  /** 上一次进入溢出恢复时的历史长度；-1 表示本次运行还没恢复过。 */
  private lastOverflowRecoveryLength = -1
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

  /**
   * 溢出恢复的闸门是「历史有没有变化」，不是「这次运行用过没有」。
   *
   * 旧实现是整次运行一次性的：第二次溢出直接不给恢复，`runPrimaryStepWithOverflowRecovery`
   * 于是抛 `CONTEXT_OVERFLOW_AFTER_COMPACTION`——可这一次压根没压缩过，错误信息在说谎，
   * 排查的人会去查压缩算法，而真正的原因是开关被永久锁死了。轮次预算放大到 70 轮之后，
   * 一次长任务溢出两回是常态，等于给长任务埋了必炸的雷。
   *
   * 换成按历史长度判定：每次压缩成功后把标记推到压缩后的长度，之后历史只增不减，跨轮次再溢出
   * 必然与标记不同、可以再恢复一次；同一轮里压缩没起作用就立刻再溢出时长度没变，仍然拒绝，
   * 不会打转。
   */
  beginOverflowRecovery(): boolean {
    const currentLength = this.options.conversation.length
    if (currentLength === this.lastOverflowRecoveryLength) return false
    this.lastOverflowRecoveryLength = currentLength
    return true
  }

  private markRecoveryPoint(): void {
    this.lastOverflowRecoveryLength = this.options.conversation.length
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
      this.markRecoveryPoint()
      return true
    } catch (error) {
      // 语义压缩失败会静默退化成确定性压缩。不记日志的话，"上下文为什么一直爆"这个问题
      // 在日志里没有任何痕迹，只能靠猜。
      logger.warn('Agent 语义压缩失败，退回确定性压缩', {
        event: 'agent_context.semantic_compaction.failed',
        requestId: this.options.runId,
        context: {
          turn,
          conversationLength: this.options.conversation.length,
          reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        },
      })
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
    this.markRecoveryPoint()
    return true
  }
}
