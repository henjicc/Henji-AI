import { describe, expect, it, vi } from 'vitest'
import {
  DeviceGenerationSerialQueue,
  ImageEditGpuRuntimeInvalidatedError,
  SingleflightRuntimeState,
} from './gpuRuntimeLifecycle'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('SingleflightRuntimeState', () => {
  it('并发 acquire 只执行一次初始化并共享同一状态', async () => {
    const pending = deferred<{ id: string }>()
    const factory = vi.fn(() => pending.promise)
    const dispose = vi.fn()
    const controller = new SingleflightRuntimeState(dispose)

    const first = controller.acquire(factory)
    const second = controller.acquire(factory)
    pending.resolve({ id: 'state-1' })

    await expect(first).resolves.toBe(await second)
    expect(factory).toHaveBeenCalledOnce()
    expect(dispose).not.toHaveBeenCalled()
  })

  it('初始化期间失效时销毁旧状态且不覆盖新状态', async () => {
    const oldPending = deferred<{ id: string }>()
    const nextPending = deferred<{ id: string }>()
    const dispose = vi.fn()
    const controller = new SingleflightRuntimeState(dispose)

    const oldAcquire = controller.acquire(() => oldPending.promise)
    controller.invalidate()
    const nextAcquire = controller.acquire(() => nextPending.promise)
    nextPending.resolve({ id: 'state-2' })
    const current = await nextAcquire
    oldPending.resolve({ id: 'state-1' })

    await expect(oldAcquire).rejects.toBeInstanceOf(ImageEditGpuRuntimeInvalidatedError)
    expect(controller.peek()).toBe(current)
    expect(dispose).toHaveBeenCalledWith({ id: 'state-1' })
    expect(dispose).not.toHaveBeenCalledWith(current)
  })

  it('destroy 释放当前状态且禁止后续初始化', async () => {
    const dispose = vi.fn()
    const controller = new SingleflightRuntimeState(dispose)
    const current = await controller.acquire(async () => ({ id: 'state-1' }))

    controller.destroy()
    controller.destroy()

    expect(dispose).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledWith(current)
    await expect(controller.acquire(async () => ({ id: 'state-2' })))
      .rejects.toThrow('已销毁')
  })
})

describe('DeviceGenerationSerialQueue', () => {
  it('同一代际串行执行，不插入额外队列栅栏', async () => {
    const queue = new DeviceGenerationSerialQueue()
    const firstPending = deferred<string>()
    const calls: string[] = []
    const first = queue.run({
      generation: 1,
      isCurrent: () => true,
      execute: async () => {
        calls.push('first-start')
        const value = await firstPending.promise
        calls.push('first-end')
        return value
      },
    })
    const second = queue.run({
      generation: 1,
      isCurrent: () => true,
      execute: async () => {
        calls.push('second')
        return 'second'
      },
    })

    await Promise.resolve()
    expect(calls).toEqual(['first-start'])
    firstPending.resolve('first')
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(calls).toEqual(['first-start', 'first-end', 'second'])
  })

  it('操作完成后代际已失效时释放结果并拒绝旧输出', async () => {
    const queue = new DeviceGenerationSerialQueue()
    const pending = deferred<{ close: () => void }>()
    const started = deferred<void>()
    const output = { close: vi.fn() }
    let current = true
    const result = queue.run({
      generation: 1,
      isCurrent: () => current,
      execute: () => {
        started.resolve()
        return pending.promise
      },
      disposeStale: (value) => value.close(),
    })

    await started.promise
    current = false
    pending.resolve(output)

    await expect(result).rejects.toBeInstanceOf(ImageEditGpuRuntimeInvalidatedError)
    expect(output.close).toHaveBeenCalledOnce()
  })
})
