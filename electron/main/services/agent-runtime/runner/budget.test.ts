import { describe, expect, it, vi } from 'vitest'

import { AgentBudgetExceededError, AgentBudgetTracker, AgentRunMetrics } from './budget'

const emptyUsage = {
  inputTokens: 0,
  inputNoCacheTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  textTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
}

describe('AgentBudgetTracker', () => {
  it('已知费用随模型 usage 累计并执行 maxCostUsd，未知费用不估算为零', () => {
    const budget = new AgentBudgetTracker({ maxCostUsd: 0.01 })
    const usage = {
      inputTokens: 1, inputNoCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 1, textTokens: 1, reasoningTokens: 0, totalTokens: 2,
    }
    budget.recordModelUsage(usage)
    expect(budget.snapshot().knownCostUsd).toBeNull()
    expect(() => budget.recordModelUsage({ ...usage, knownCostUsd: 0.02 }))
      .toThrow(AgentBudgetExceededError)
  })
  it('累计模型和工具预算', () => {
    const budget = new AgentBudgetTracker({ maxTurns: 2, maxToolCalls: 1 })
    expect(budget.beginTurn()).toBe(1)
    budget.recordModelUsage({ ...emptyUsage, inputTokens: 4, outputTokens: 2, totalTokens: 6 })
    budget.recordToolCall('tool:a')
    expect(budget.snapshot()).toMatchObject({ turns: 1, toolCalls: 1, inputTokens: 4, outputTokens: 2 })
    expect(() => budget.recordToolCall('tool:b')).toThrowError(AgentBudgetExceededError)
  })

  it('阻止重复调用、无进展和超时', () => {
    vi.useFakeTimers()
    const budget = new AgentBudgetTracker({
      maxRepeatedToolCalls: 1,
      maxNoProgressTurns: 1,
      maxDurationMs: 1_000,
    })
    budget.recordToolCall('same')
    expect(() => budget.recordToolCall('same')).toThrowError(/重复工具调用/)

    const progressBudget = new AgentBudgetTracker({ maxNoProgressTurns: 1 })
    progressBudget.recordProgress('same')
    expect(() => progressBudget.recordProgress('same')).toThrowError(/没有产生新进展/)

    const timeBudget = new AgentBudgetTracker({ maxDurationMs: 1_000 })
    vi.advanceTimersByTime(1_001)
    expect(() => timeBudget.assertWithinLimits()).toThrowError(/最大运行时长/)
    vi.useRealTimers()
  })

  it('默认不按跨轮累计 Token 终止，显式限制仍然生效', () => {
    const unlimited = new AgentBudgetTracker()
    unlimited.recordModelUsage({
      ...emptyUsage,
      inputTokens: 150_000,
      outputTokens: 40_000,
      totalTokens: 190_000,
    })
    expect(unlimited.snapshot()).toMatchObject({ inputTokens: 150_000, outputTokens: 40_000 })

    const limited = new AgentBudgetTracker({ maxInputTokens: 100, maxOutputTokens: 100 })
    expect(() => limited.recordModelUsage({
      ...emptyUsage,
      inputTokens: 101,
      totalTokens: 101,
    })).toThrowError(/输入 token 预算/)
  })

  it('桌面默认统计超过旧 12 轮和 24 次工具后仍不终止', () => {
    const metrics = new AgentRunMetrics()
    for (let turn = 0; turn < 30; turn += 1) {
      expect(metrics.beginTurn()).toBe(turn + 1)
      metrics.recordToolCall(`tool:${turn}:a`)
      metrics.recordToolCall(`tool:${turn}:b`)
    }
    expect(metrics.snapshot()).toMatchObject({ turns: 30, toolCalls: 60 })
    expect(metrics.config).toMatchObject({
      maxTurns: null,
      maxToolCalls: null,
      maxDurationMs: null,
    })
  })
})
