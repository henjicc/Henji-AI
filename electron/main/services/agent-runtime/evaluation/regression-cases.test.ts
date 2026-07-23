import { describe, expect, it } from 'vitest'

import { ASSISTANT_REGRESSION_CASES } from './regression-cases'

describe('assistant regression datasets', () => {
  it('包含黄金、历史失败和对抗三类可扩展数据集', () => {
    const categories = new Set(ASSISTANT_REGRESSION_CASES.map((item) => item.category))
    expect(categories).toEqual(new Set(['golden', 'historical', 'adversarial']))
    expect(ASSISTANT_REGRESSION_CASES.length).toBeGreaterThanOrEqual(9)
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
})
