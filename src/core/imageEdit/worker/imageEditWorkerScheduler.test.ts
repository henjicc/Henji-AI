import { describe, expect, it, vi } from 'vitest'
import { ImageEditWorkerScheduler } from './imageEditWorkerScheduler'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('ImageEditWorkerScheduler', () => {
  it('同一会话保持一个运行中预览和一个 latest-pending', async () => {
    const scheduler = new ImageEditWorkerScheduler()
    const running = deferred()
    const calls: string[] = []
    const droppedSecond = vi.fn()
    const done = deferred()

    scheduler.enqueuePreview('editor-a', {
      run: async () => {
        calls.push('first')
        await running.promise
      },
      onDropped: vi.fn(),
    })
    scheduler.enqueuePreview('editor-a', {
      run: async () => { calls.push('second') },
      onDropped: droppedSecond,
    })
    scheduler.enqueuePreview('editor-a', {
      run: async () => {
        calls.push('third')
        done.resolve()
      },
      onDropped: vi.fn(),
    })

    expect(calls).toEqual(['first'])
    expect(droppedSecond).toHaveBeenCalledOnce()
    running.resolve()
    await done.promise
    expect(calls).toEqual(['first', 'third'])
    scheduler.destroy()
  })

  it('设备失效会丢弃未开始任务，当前任务结束后不再执行旧队列', async () => {
    const scheduler = new ImageEditWorkerScheduler()
    const running = deferred()
    const droppedPreview = vi.fn()
    const droppedExport = vi.fn()
    const calls: string[] = []

    scheduler.enqueueControl({
      run: async () => {
        calls.push('active')
        await running.promise
      },
      onDropped: vi.fn(),
    })
    scheduler.enqueuePreview('editor-a', {
      run: async () => { calls.push('preview') },
      onDropped: droppedPreview,
    })
    scheduler.enqueueExport({
      run: async () => { calls.push('export') },
      onDropped: droppedExport,
    })

    scheduler.invalidatePending()
    running.resolve()
    await Promise.resolve()

    expect(calls).toEqual(['active'])
    expect(droppedPreview).toHaveBeenCalledOnce()
    expect(droppedExport).toHaveBeenCalledOnce()
    scheduler.destroy()
  })
})
