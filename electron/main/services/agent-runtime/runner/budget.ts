import type { ModelStepUsage } from '../../../../../src/core/llm/modelStep'
import {
  agentBudgetConfigSchema,
  type AgentBudgetConfig,
  type AgentBudgetUsage,
} from '../../../../../src/core/assistant/events'

/**
 * 预算按"完成任务"标定，而不是按"省钱"标定。
 *
 * 一个多 Facet 任务（建工程 → 打开页面 → 布景 → 运镜 → 关键帧 → 验证）光协议往返就要十几轮；
 * 旧的 20/32 轮意味着模型刚开始干正事就撞软预算。写入上限 12 更是直接卡死"放 N 个物体 +
 * 逐个改属性 + 写关键帧"这类完全正常的批量任务。
 */
export const DEFAULT_AGENT_BUDGET: AgentBudgetConfig = {
  softMaxTurns: 45,
  maxTurns: 70,
  softMaxToolCalls: 140,
  maxToolCalls: 220,
  softMaxWriteToolCalls: 45,
  maxWriteToolCalls: 90,
  maxDurationMs: 30 * 60 * 1_000,
  maxInputTokens: null,
  maxOutputTokens: null,
  maxConsecutiveFailures: 5,
  maxRepeatedToolCalls: 2,
  maxNoProgressTurns: 4,
  softMaxCostUsd: 3,
  maxCostUsd: 10,
}

export type AgentBudgetSoftLimitCode =
  | 'SOFT_MAX_TURNS'
  | 'SOFT_MAX_TOOL_CALLS'
  | 'SOFT_MAX_WRITE_TOOL_CALLS'
  | 'SOFT_MAX_COST'
  | 'SOFT_CONSECUTIVE_FAILURES'
  | 'SOFT_REPEATED_TOOL_CALLS'
  | 'SOFT_NO_PROGRESS_TURNS'

/**
 * 只有这几项代表"资源真的快用完了"，才该进入收尾模式。
 *
 * 其余三项（连续失败、重复调用、无新进展）是**质量信号**：它们描述的是模型这几步走得不好，
 * 而不是任务做不完了。旧实现把它们一并塞进 closeout，而 closeout 会永久摘掉
 * discover_application_capabilities——于是任意两次抖动就让助手在整次运行里再也学不到新能力，
 * 多 Facet 任务必然半途而废。实测第一次运行就是在第 14 轮被这条掐进收尾模式的。
 */
const BUDGET_EXHAUSTION_CODES = new Set<AgentBudgetSoftLimitCode>([
  'SOFT_MAX_TURNS',
  'SOFT_MAX_TOOL_CALLS',
  'SOFT_MAX_WRITE_TOOL_CALLS',
  'SOFT_MAX_COST',
])

export function isBudgetExhaustionSoftLimit(code: AgentBudgetSoftLimitCode): boolean {
  return BUDGET_EXHAUSTION_CODES.has(code)
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
  private lastToolSignature: string | null = null
  private repeatedToolCalls = 0
  private turns = 0
  private toolCalls = 0
  private writeToolCalls = 0
  private inputTokens = 0
  private outputTokens = 0
  private reasoningTokens = 0
  private totalTokens = 0
  private knownCostUsd: number | null = null
  private consecutiveFailures = 0
  private noProgressTurns = 0
  private lastProgressMarker: string | null = null
  private readonly reportedSoftLimits = new Set<AgentBudgetSoftLimitCode>()

  constructor(config: AgentStopPolicy = {}) {
    this.config = agentBudgetConfigSchema.parse({ ...DEFAULT_AGENT_BUDGET, ...config })
  }

  beginTurn(): number {
    this.assertWithinLimits()
    if (this.config.maxTurns !== null && this.turns >= this.config.maxTurns) {
      throw new AgentStopPolicyExceededError('MAX_TURNS', '已达到智能助手最大轮次，已停止继续尝试')
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

  recordToolCall(signature: string, write = false): void {
    this.assertWithinLimits()
    if (this.config.maxToolCalls !== null && this.toolCalls >= this.config.maxToolCalls) {
      throw new AgentStopPolicyExceededError('MAX_TOOL_CALLS', '已达到智能助手最大工具调用次数，已停止继续尝试')
    }
    if (write && this.config.maxWriteToolCalls !== null && this.writeToolCalls >= this.config.maxWriteToolCalls) {
      throw new AgentStopPolicyExceededError('MAX_WRITE_TOOL_CALLS', '已达到智能助手最大写入调用次数，已停止继续尝试')
    }
    this.toolCalls += 1
    if (write) this.writeToolCalls += 1
    if (signature === this.lastToolSignature) this.repeatedToolCalls += 1
    else {
      this.lastToolSignature = signature
      this.repeatedToolCalls = 1
    }
    if (
      this.config.maxRepeatedToolCalls !== null
      && this.repeatedToolCalls > this.config.maxRepeatedToolCalls
    ) {
      throw new AgentStopPolicyExceededError('REPEATED_TOOL_CALL', '重复工具调用使用相同参数仍无新进展，已停止继续尝试')
    }
  }

  recordFailure(): void {
    this.consecutiveFailures += 1
    if (
      this.config.maxConsecutiveFailures !== null
      && this.consecutiveFailures >= this.config.maxConsecutiveFailures
    ) {
      throw new AgentStopPolicyExceededError('CONSECUTIVE_FAILURES', '工具或模型连续失败，已停止继续尝试以避免重复操作')
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0
    // 真有进展就把质量类告警解除武装，后面再卡住时才能重新提醒；
    // 否则一次抖动会让告警永久留在已上报集合里，既不再提醒也污染收尾判定。
    this.reportedSoftLimits.delete('SOFT_CONSECUTIVE_FAILURES')
  }

  recordProgress(marker: string): void {
    if (marker === this.lastProgressMarker) this.noProgressTurns += 1
    else {
      this.noProgressTurns = 0
      this.lastToolSignature = null
      this.repeatedToolCalls = 0
      this.reportedSoftLimits.delete('SOFT_NO_PROGRESS_TURNS')
      this.reportedSoftLimits.delete('SOFT_REPEATED_TOOL_CALLS')
    }
    this.lastProgressMarker = marker
    if (
      this.config.maxNoProgressTurns !== null
      && this.noProgressTurns >= this.config.maxNoProgressTurns
    ) {
      throw new AgentStopPolicyExceededError('NO_PROGRESS', '多轮执行没有产生新进展，已停止继续尝试')
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
      throw new AgentStopPolicyExceededError('MAX_DURATION', '已达到智能助手最大运行时长，已停止继续尝试')
    }
    if (this.config.maxInputTokens !== null && this.inputTokens > this.config.maxInputTokens) {
      throw new AgentStopPolicyExceededError('MAX_INPUT_TOKENS', '已达到智能助手输入 token 预算，已停止继续尝试')
    }
    if (this.config.maxOutputTokens !== null && this.outputTokens > this.config.maxOutputTokens) {
      throw new AgentStopPolicyExceededError('MAX_OUTPUT_TOKENS', '已达到智能助手输出 token 预算，已停止继续尝试')
    }
    if (
      this.config.maxCostUsd !== undefined
      && this.config.maxCostUsd !== null
      && this.knownCostUsd !== null
      && this.knownCostUsd > this.config.maxCostUsd
    ) {
      throw new AgentStopPolicyExceededError('MAX_COST', '已达到智能助手已知费用上限，已停止继续尝试')
    }
  }

  consumeNewSoftLimits(): AgentBudgetSoftLimitCode[] {
    const reached: AgentBudgetSoftLimitCode[] = []
    const add = (code: AgentBudgetSoftLimitCode, condition: boolean): void => {
      if (!condition || this.reportedSoftLimits.has(code)) return
      this.reportedSoftLimits.add(code)
      reached.push(code)
    }
    add('SOFT_MAX_TURNS', this.config.softMaxTurns !== null && this.turns >= this.config.softMaxTurns)
    add(
      'SOFT_MAX_TOOL_CALLS',
      this.config.softMaxToolCalls !== null && this.toolCalls >= this.config.softMaxToolCalls
    )
    add(
      'SOFT_MAX_WRITE_TOOL_CALLS',
      this.config.softMaxWriteToolCalls !== null && this.writeToolCalls >= this.config.softMaxWriteToolCalls
    )
    add(
      'SOFT_MAX_COST',
      this.config.softMaxCostUsd !== null
        && this.knownCostUsd !== null
        && this.knownCostUsd >= this.config.softMaxCostUsd
    )
    add('SOFT_CONSECUTIVE_FAILURES', this.consecutiveFailures >= 2)
    add('SOFT_REPEATED_TOOL_CALLS', this.repeatedToolCalls >= 2)
    add('SOFT_NO_PROGRESS_TURNS', this.noProgressTurns >= 2)
    return reached
  }

  isCloseoutMode(): boolean {
    return [...this.reportedSoftLimits].some(isBudgetExhaustionSoftLimit)
  }

  snapshot(): AgentBudgetUsage {
    return {
      turns: this.turns,
      toolCalls: this.toolCalls,
      writeToolCalls: this.writeToolCalls,
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
