import type { ModelStepUsage } from '../../../../../src/core/llm/modelStep'
import {
  agentBudgetConfigSchema,
  type AgentBudgetConfig,
  type AgentBudgetUsage,
} from '../../../../../src/core/assistant/events'

export const DEFAULT_AGENT_BUDGET: AgentBudgetConfig = {
  maxTurns: null,
  maxToolCalls: null,
  maxDurationMs: null,
  maxInputTokens: null,
  maxOutputTokens: null,
  maxConsecutiveFailures: null,
  maxRepeatedToolCalls: null,
  maxNoProgressTurns: null,
  maxCostUsd: null,
}

export type AgentStopPolicy = Partial<AgentBudgetConfig>

export class AgentStopPolicyExceededError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'AgentStopPolicyExceededError'
  }
}

/** @deprecated 使用 AgentStopPolicyExceededError。 */
export const AgentBudgetExceededError = AgentStopPolicyExceededError

function tokenValue(value: number | null): number {
  return value ?? 0
}

export class AgentRunMetrics {
  readonly config: AgentBudgetConfig
  private readonly startedAt = Date.now()
  private readonly toolSignatures = new Map<string, number>()
  private turns = 0
  private toolCalls = 0
  private inputTokens = 0
  private outputTokens = 0
  private reasoningTokens = 0
  private totalTokens = 0
  private knownCostUsd: number | null = null
  private consecutiveFailures = 0
  private noProgressTurns = 0
  private lastProgressMarker: string | null = null

  constructor(config: AgentStopPolicy = {}) {
    this.config = agentBudgetConfigSchema.parse({ ...DEFAULT_AGENT_BUDGET, ...config })
  }

  beginTurn(): number {
    this.assertWithinLimits()
    if (this.config.maxTurns !== null && this.turns >= this.config.maxTurns) {
      throw new AgentStopPolicyExceededError('MAX_TURNS', '已达到显式设置的 Agent 最大轮次')
    }
    this.turns += 1
    return this.turns
  }

  recordModelUsage(usage: ModelStepUsage): void {
    this.inputTokens += tokenValue(usage.inputTokens)
    this.outputTokens += tokenValue(usage.outputTokens)
    this.reasoningTokens += tokenValue(usage.reasoningTokens)
    this.totalTokens += tokenValue(usage.totalTokens)
    if (usage.knownCostUsd !== null && usage.knownCostUsd !== undefined) {
      this.recordKnownCost(usage.knownCostUsd)
    }
    this.assertWithinLimits()
  }

  recordToolCall(signature: string): void {
    if (this.config.maxToolCalls !== null && this.toolCalls >= this.config.maxToolCalls) {
      throw new AgentStopPolicyExceededError('MAX_TOOL_CALLS', '已达到显式设置的 Agent 最大工具调用次数')
    }
    this.toolCalls += 1
    const repeats = (this.toolSignatures.get(signature) ?? 0) + 1
    this.toolSignatures.set(signature, repeats)
    if (
      this.config.maxRepeatedToolCalls !== null
      && repeats > this.config.maxRepeatedToolCalls
    ) {
      throw new AgentStopPolicyExceededError('REPEATED_TOOL_CALL', '已达到显式设置的重复工具调用次数')
    }
  }

  recordFailure(): void {
    this.consecutiveFailures += 1
    if (
      this.config.maxConsecutiveFailures !== null
      && this.consecutiveFailures >= this.config.maxConsecutiveFailures
    ) {
      throw new AgentStopPolicyExceededError('CONSECUTIVE_FAILURES', '已达到显式设置的连续失败次数')
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0
  }

  recordProgress(marker: string): void {
    if (marker === this.lastProgressMarker) this.noProgressTurns += 1
    else this.noProgressTurns = 0
    this.lastProgressMarker = marker
    if (
      this.config.maxNoProgressTurns !== null
      && this.noProgressTurns >= this.config.maxNoProgressTurns
    ) {
      throw new AgentStopPolicyExceededError('NO_PROGRESS', '已达到显式设置的没有产生新进展轮数')
    }
  }

  recordKnownCost(amountUsd: number): void {
    if (!Number.isFinite(amountUsd) || amountUsd < 0) return
    this.knownCostUsd = (this.knownCostUsd ?? 0) + amountUsd
    this.assertWithinLimits()
  }

  assertWithinLimits(): void {
    if (
      this.config.maxDurationMs !== null
      && Date.now() - this.startedAt > this.config.maxDurationMs
    ) {
      throw new AgentStopPolicyExceededError('MAX_DURATION', '已达到显式设置的 Agent 最大运行时长')
    }
    if (this.config.maxInputTokens !== null && this.inputTokens > this.config.maxInputTokens) {
      throw new AgentStopPolicyExceededError('MAX_INPUT_TOKENS', '已达到显式设置的 Agent 输入 token 预算')
    }
    if (this.config.maxOutputTokens !== null && this.outputTokens > this.config.maxOutputTokens) {
      throw new AgentStopPolicyExceededError('MAX_OUTPUT_TOKENS', '已达到显式设置的 Agent 输出 token 预算')
    }
    if (
      this.config.maxCostUsd !== undefined
      && this.config.maxCostUsd !== null
      && this.knownCostUsd !== null
      && this.knownCostUsd > this.config.maxCostUsd
    ) {
      throw new AgentStopPolicyExceededError('MAX_COST', '已达到显式设置的 Agent 已知费用')
    }
  }

  snapshot(): AgentBudgetUsage {
    return {
      turns: this.turns,
      toolCalls: this.toolCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      reasoningTokens: this.reasoningTokens,
      totalTokens: this.totalTokens,
      knownCostUsd: this.knownCostUsd,
      consecutiveFailures: this.consecutiveFailures,
      noProgressTurns: this.noProgressTurns,
      elapsedMs: Math.max(0, Date.now() - this.startedAt),
    }
  }
}

/** @deprecated 兼容旧调用；新代码应使用 AgentRunMetrics。 */
export class AgentBudgetTracker extends AgentRunMetrics {}
