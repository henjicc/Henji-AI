import { describe, expect, it } from 'vitest'

import { createCanvasExecutionLimiter } from './canvasExecutionLimiter'

describe('canvasExecutionLimiter', () => {
  it('调高立即启动等待项，调低不会取消执行中的任务或提前放行', async () => {
    const limiter = createCanvasExecutionLimiter(1)
    const started: number[] = []
    const release: Array<() => void> = []
    const tasks = [0, 1, 2].map(id => limiter.run(async () => {
      started.push(id)
      await new Promise<void>(resolve => { release[id] = resolve })
    }))
    await Promise.resolve()
    expect(started).toEqual([0])
    limiter.setMaxConcurrency(2)
    await Promise.resolve(); await Promise.resolve()
    expect(started).toEqual([0, 1])
    limiter.setMaxConcurrency(1)
    release[0](); await tasks[0]
    expect(started).toEqual([0, 1])
    release[1](); await tasks[1]
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2])
    release[2](); await Promise.all(tasks)
  })

  it('排队取消立即返回并移除等待项，不占用或释放其他任务的名额', async () => {
    const limiter = createCanvasExecutionLimiter(1)
    const started: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const first = limiter.run(async () => { started.push('first'); await gate })
    const controller = new AbortController()
    const cancelled = limiter.run(async () => { started.push('cancelled') }, controller.signal)
    const last = limiter.run(async () => { started.push('last') })
    try {
      controller.abort(new Error('停止队列'))
      await expect(cancelled).rejects.toThrow('停止队列')
      expect(started).toEqual(['first'])
    } finally { release(); await Promise.allSettled([first, cancelled, last]) }
    expect(started).toEqual(['first', 'last'])
  })

  it('移交名额后才取消仍不调用业务，名额继续传给后续任务', async () => {
    const limiter = createCanvasExecutionLimiter(1)
    const controller = new AbortController()
    const started: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const first = limiter.run(async () => { await gate })
    const second = limiter.run(async () => { started.push('second') }, controller.signal)
    const third = limiter.run(async () => { started.push('third') })
    const cancellation = first.then(() => controller.abort(new Error('移交时取消')))
    release()
    await expect(second).rejects.toThrow('移交时取消')
    await Promise.all([first, third, cancellation])
    expect(started).toEqual(['third'])
  })

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
