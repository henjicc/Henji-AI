import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/commands/applicationControl', () => ({ getApplicationHostService: vi.fn() }))
vi.mock('./hostContext/hostContext', () => ({ createHostContextSnapshot: vi.fn(), retainHostContextTracking: vi.fn(), subscribeHostContext: vi.fn() }))
vi.mock('./operationReviews', () => ({ attachOperationReviews: vi.fn() }))
vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: { getState: vi.fn() } }))

import { createHostContextPublishScheduler } from './useApplicationHost'

afterEach(() => { vi.useRealTimers() })

describe('宿主上下文发布节流', () => {
  it('拖动中 60 次节点变化最多发布两次，松手立即补发最终快照', async () => {
    vi.useFakeTimers()
    let nodesVersion = 0
    let dragging = true
    const published: number[] = []
    const scheduler = createHostContextPublishScheduler(() => published.push(nodesVersion), () => dragging)
    for (let frame = 0; frame < 60; frame++) {
      nodesVersion += 1
      scheduler.request()
      await vi.advanceTimersByTimeAsync(4)
    }
    expect(published.length).toBeLessThanOrEqual(2)
    nodesVersion += 1
    dragging = false
    scheduler.request()
    await Promise.resolve()
    expect(published.at(-1)).toBe(61)
    expect(published.length).toBeLessThanOrEqual(3)
    await vi.advanceTimersByTimeAsync(1000)
    expect(published.length).toBeLessThanOrEqual(3)
    scheduler.dispose()
  })
})
