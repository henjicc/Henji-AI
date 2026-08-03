import { describe, expect, it } from 'vitest'

import { estimateAgentTextTokens, truncateToAgentTokenBudget } from './tokenEstimate'

/**
 * 这里守的是"估算不能低估中文"。低估的代价不是省钱，是预算失真：分层按低估口径把层塞满，
 * 构建器再用另一套口径一量发现超了，就掉头去砍活动工具——现象是"工具位莫名其妙不够用"，
 * 而真正的原因是内容里中文多。
 */
describe('Agent 文本 token 估算', () => {
  it('中文按一字一 token，不再被 /4 低估', () => {
    const chinese = '生成一张剪纸风格的小猫图片'
    expect(estimateAgentTextTokens(chinese)).toBe(chinese.length)
    // 旧口径会给出 4 分之一，这个差距正是预算失真的来源
    expect(estimateAgentTextTokens(chinese)).toBeGreaterThan(Math.ceil(chinese.length / 4) * 3)
  })

  it('英文与标点分档计权，空白不计', () => {
    expect(estimateAgentTextTokens('abcdef')).toBe(2)
    expect(estimateAgentTextTokens('    ')).toBe(0)
    expect(estimateAgentTextTokens('{}[]')).toBe(2)
  })

  it('截断按同一套权重扫描，中文不会放行四倍预算', () => {
    const chinese = '中'.repeat(500)
    const result = truncateToAgentTokenBudget(chinese, 100)
    expect(result.truncated).toBe(true)
    expect(estimateAgentTextTokens(result.text)).toBeLessThanOrEqual(100)
    // 旧实现按 maxTokens * 4 换算字符数，这里会放进 400 字
    expect(result.text.length).toBeLessThanOrEqual(100)
  })

  it('预算够时原样返回', () => {
    const text = '短文本'
    expect(truncateToAgentTokenBudget(text, 100)).toEqual({ text, truncated: false })
  })

  it('截断结果始终是估算的下界，不会自相矛盾', () => {
    for (const text of ['纯中文内容'.repeat(40), 'plain ascii text '.repeat(40), '混合 mixed 内容 42 次'.repeat(30)]) {
      for (const budget of [10, 50, 200]) {
        const result = truncateToAgentTokenBudget(text, budget)
        expect(estimateAgentTextTokens(result.text)).toBeLessThanOrEqual(budget)
      }
    }
  })
})
