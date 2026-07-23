import type { ModelStepUsage } from '../../../../../src/core/llm/modelStep'
import {
  agentBudgetConfigSchema,
  type AgentBudgetConfig,
  type AgentBudgetUsage,
} from '../../../../../src/core/assistant/events'

export const DEFAULT_AGENT_BUDGET: AgentBudgetConfig = {
  maxTurns: 12,
  maxToolCalls: 24,
  maxDurationMs: 10 * 60 * 1_000,
  maxInputTokens: 120_000,
  maxOutputTokens: 32_000,
  maxConsecutiveFailures: 3,
  maxRepeatedToolCalls: 2,
  maxNoProgressTurns: 3,
}

export class AgentBudgetExceededError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'AgentBudgetExceededError'
  }
}

function tokenValue(value: number | null): number {
  return value ?? 0
}

export class AgentBudgetTracker {
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

  constructor(config: Partial<AgentBudgetConfig> = {}) {
    this.config = agentBudgetConfigSchema.parse({ ...DEFAULT_AGENT_BUDGET, ...config })
  }

  beginTurn(): number {
    this.assertWithinLimits()
    if (this.turns >= this.config.maxTurns) {
      throw new AgentBudgetExceededError('MAX_TURNS', '已达到 Agent 最大轮次预算')
    }
    this.turns += 1
    return this.turns
  }

  recordModelUsage(usage: ModelStepUsage): void {
    this.inputTokens += tokenValue(usage.inputTokens)
    this.outputTokens += tokenValue(usage.outputTokens)
    this.reasoningTokens += tokenValue(usage.reasoningTokens)
    this.totalTokens += tokenValue(usage.totalTokens)
    this.assertWithinLimits()
  }

  recordToolCall(signature: string): void {
    if (this.toolCalls >= this.config.maxToolCalls) {
      throw new AgentBudgetExceededError('MAX_TOOL_CALLS', '已达到 Agent 最大工具调用预算')
    }
    this.toolCalls += 1
    const repeats = (this.toolSignatures.get(signature) ?? 0) + 1
    this.toolSignatures.set(signature, repeats)
    if (repeats > this.config.maxRepeatedToolCalls) {
      throw new AgentBudgetExceededError('REPEATED_TOOL_CALL', '检测到重复工具调用，运行已停止')
    }
  }

  recordFailure(): void {
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      throw new AgentBudgetExceededError('CONSECUTIVE_FAILURES', '连续失败次数已达到预算上限')
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0
  }

  recordProgress(marker: string): void {
    if (marker === this.lastProgressMarker) this.noProgressTurns += 1
    else this.noProgressTurns = 0
    this.lastProgressMarker = marker
    if (this.noProgressTurns >= this.config.maxNoProgressTurns) {
      throw new AgentBudgetExceededError('NO_PROGRESS', '连续多轮没有产生新进展，运行已停止')
    }
  }

  recordKnownCost(amountUsd: number): void {
    if (!Number.isFinite(amountUsd) || amountUsd < 0) return
    this.knownCostUsd = (this.knownCostUsd ?? 0) + amountUsd
    this.assertWithinLimits()
  }

  assertWithinLimits(): void {
    if (Date.now() - this.startedAt > this.config.maxDurationMs) {
      throw new AgentBudgetExceededError('MAX_DURATION', '已达到 Agent 最大运行时长')
    }
    if (this.inputTokens > this.config.maxInputTokens) {
      throw new AgentBudgetExceededError('MAX_INPUT_TOKENS', '已达到 Agent 输入 token 预算')
    }
    if (this.outputTokens > this.config.maxOutputTokens) {
      throw new AgentBudgetExceededError('MAX_OUTPUT_TOKENS', '已达到 Agent 输出 token 预算')
    }
    if (
      this.config.maxCostUsd !== undefined
      && this.knownCostUsd !== null
      && this.knownCostUsd > this.config.maxCostUsd
    ) {
      throw new AgentBudgetExceededError('MAX_COST', '已达到 Agent 已知费用预算')
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
