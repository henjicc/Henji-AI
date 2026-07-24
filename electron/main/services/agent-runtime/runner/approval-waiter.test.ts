import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentApprovalWaiter } from './approval-waiter'

afterEach(() => {
  vi.useRealTimers()
})

describe('AgentApprovalWaiter', () => {
  it('外部处理审批后立即结束等待并取消过期回调', async () => {
    vi.useFakeTimers()
    const waiter = new AgentApprovalWaiter()
    const onExpired = vi.fn()
    const pending = waiter.wait({
      approvalId: 'approval-1',
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
      onExpired,
    })

    waiter.settle('approve')

    await expect(pending).resolves.toBe('approve')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(onExpired).not.toHaveBeenCalled()
  })

  it('到期时执行清理回调并返回过期结果', async () => {
    vi.useFakeTimers()
    const waiter = new AgentApprovalWaiter()
    const onExpired = vi.fn()
    const pending = waiter.wait({
      approvalId: 'approval-2',
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
      onExpired,
    })

    await vi.advanceTimersByTimeAsync(1_000)

    await expect(pending).resolves.toBe('expired')
    expect(onExpired).toHaveBeenCalledOnce()
    expect(waiter.matches('approval-2')).toBe(false)
  })
})
