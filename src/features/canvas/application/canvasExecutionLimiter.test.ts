import { describe, expect, it } from 'vitest'

import { createCanvasExecutionLimiter } from './canvasExecutionLimiter'

describe('canvasExecutionLimiter', () => {
  it('max=1 时把 permit 直接移交给队首，不让插队微任务并发启动', async () => {
    const limiter = createCanvasExecutionLimiter(1)
    const started: string[] = []
    let runningCount = 0
    let maxRunningCount = 0
    let releaseFirst: (() => void) | undefined
    let markFirstStarted: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })
    const operation = async (name: string, gate?: Promise<void>): Promise<void> => {
      started.push(name)
      runningCount += 1
      maxRunningCount = Math.max(maxRunningCount, runningCount)
      if (name === 'first') markFirstStarted?.()
      await (gate ?? new Promise<void>((resolve) => queueMicrotask(resolve)))
      runningCount -= 1
    }

    const first = limiter.run(() => operation('first', firstGate))
    const second = limiter.run(() => operation('second'))
    await firstStarted
    releaseFirst?.()
    // first 完成回调会排在 second 的 acquire 续体之后、operation 续体之前，
    // 精确覆盖“队首已被唤醒但尚未开始执行”这段 permit 移交窗口。
    const third = first.then(() => limiter.run(() => operation('third')))

    await Promise.all([first, second, third])
    expect(started).toEqual(['first', 'second', 'third'])
    expect(maxRunningCount).toBe(1)
  })
})
