import { describe, expect, it } from 'vitest'

import { ASSISTANT_REGRESSION_CASES } from './regression-cases'

describe('assistant regression datasets', () => {
  it('包含黄金、历史失败、对抗、边界和恢复数据集', () => {
    const categories = new Set(ASSISTANT_REGRESSION_CASES.map((item) => item.category))
    expect(categories).toEqual(new Set(['golden', 'historical', 'adversarial', 'boundary', 'recovery']))
    expect(ASSISTANT_REGRESSION_CASES.length).toBeGreaterThanOrEqual(16)
  })

  it('所有用例都有预算、安全约束和唯一标识', () => {
    const ids = ASSISTANT_REGRESSION_CASES.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ASSISTANT_REGRESSION_CASES.every((item) => (
      item.maxLatencyMs > 0
      && item.maxInputTokens > 0
      && item.maxOutputTokens > 0
      && Array.isArray(item.forbiddenTools)
    ))).toBe(true)
  })

  it('智能性基线覆盖七类场景并记录可验证约束', () => {
    const baselineCases = ASSISTANT_REGRESSION_CASES.filter((item) => item.baselineScenario)
    expect(new Set(baselineCases.map((item) => item.baselineScenario))).toEqual(new Set([
      'generation', 'ambiguous', 'cross_workspace', 'model_preference',
      'tool_recovery', 'write_verification', 'long_context',
    ]))
    expect(baselineCases.every((item) => (
      (item.acceptableToolSequences?.length ?? 0) > 0
      && (item.successEvidence?.length ?? 0) > 0
      && (item.forbiddenBehaviors?.length ?? 0) > 0
    ))).toBe(true)
  })
})
