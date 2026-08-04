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

  it('桌面默认在第 20 轮进入收口，并在 32 轮后阻止第 33 轮', () => {
    const metrics = new AgentRunMetrics()
    for (let turn = 0; turn < 32; turn += 1) {
      expect(metrics.beginTurn()).toBe(turn + 1)
      if (turn === 19) expect(metrics.consumeNewSoftLimits()).toContain('SOFT_MAX_TURNS')
    }
    expect(() => metrics.beginTurn()).toThrowError(/最大轮次/)
    expect(metrics.snapshot()).toMatchObject({ turns: 32, toolCalls: 0, writeToolCalls: 0 })
    expect(metrics.config).toMatchObject({
      softMaxTurns: 20,
      maxTurns: 32,
      softMaxToolCalls: 50,
      maxToolCalls: 100,
      softMaxWriteToolCalls: 12,
      maxWriteToolCalls: 24,
      maxDurationMs: 30 * 60 * 1_000,
      maxConsecutiveFailures: 3,
      maxRepeatedToolCalls: 2,
      maxNoProgressTurns: 3,
    })
  })

  it('分别统计工具与写入工具，并且软上限事件只消费一次', () => {
    const metrics = new AgentRunMetrics({
      softMaxToolCalls: 2,
      maxToolCalls: 3,
      softMaxWriteToolCalls: 1,
      maxWriteToolCalls: 2,
    })
    metrics.recordToolCall('read:a', false)
    metrics.recordToolCall('write:a', true)
    expect(metrics.consumeNewSoftLimits()).toEqual([
      'SOFT_MAX_TOOL_CALLS',
      'SOFT_MAX_WRITE_TOOL_CALLS',
    ])
    expect(metrics.consumeNewSoftLimits()).toEqual([])
    metrics.recordToolCall('write:b', true)
    expect(metrics.snapshot()).toMatchObject({ toolCalls: 3, writeToolCalls: 2 })
    expect(() => metrics.recordToolCall('write:c', true)).toThrowError(/最大工具调用次数/)
  })

  it('桌面默认在连续失败和相同工具重复调用时主动停止', () => {
    const failures = new AgentRunMetrics()
    failures.recordFailure()
    failures.recordFailure()
    expect(() => failures.recordFailure()).toThrowError(/连续失败/)

    const repeats = new AgentRunMetrics()
    repeats.recordToolCall('same')
    repeats.recordToolCall('same')
    expect(() => repeats.recordToolCall('same')).toThrowError(/重复工具调用/)
  })

  it('只阻止连续且无新进展的重复调用，不误伤分阶段复用和轮询', () => {
    const staged = new AgentRunMetrics({ maxRepeatedToolCalls: 1 })
    staged.recordToolCall('query:same')
    staged.recordToolCall('update:other')
    expect(() => staged.recordToolCall('query:same')).not.toThrow()

    const polling = new AgentRunMetrics({ maxRepeatedToolCalls: 1 })
    polling.recordToolCall('query:status')
    polling.recordProgress('query:status:pending')
    polling.recordToolCall('query:status')
    polling.recordProgress('query:status:completed')
    expect(() => polling.recordToolCall('query:status')).not.toThrow()
  })
})
