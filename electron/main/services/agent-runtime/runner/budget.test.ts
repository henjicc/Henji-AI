import { describe, expect, it, vi } from 'vitest'

import { AgentBudgetExceededError, AgentBudgetTracker } from './budget'

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
})
