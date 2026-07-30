import { describe, expect, it } from 'vitest'

import { AgentClarificationWaiter } from './clarification-waiter'

describe('AgentClarificationWaiter', () => {
  it('只允许匹配的 waitId 消费一次', async () => {
    const waiter = new AgentClarificationWaiter()
    const answer = waiter.wait('wait-1')
    expect(waiter.matches('wait-1')).toBe(true)
    expect(waiter.settle('wait-other', '错误回答')).toBe(false)
    expect(waiter.settle('wait-1', '正确回答')).toBe(true)
    expect(waiter.settle('wait-1', '重复回答')).toBe(false)
    await expect(answer).resolves.toBe('正确回答')
  })
})
