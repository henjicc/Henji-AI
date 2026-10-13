import { expect, it, vi } from 'vitest'
import { createRafScheduler } from './createRafScheduler'

it('一帧合并最新样本，flush 提交末样本，cancel 丢弃；支持在回调中调度下一帧', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0
  const owner = { requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => { frames.set(++id, callback); return id }), cancelAnimationFrame: vi.fn((key: number) => frames.delete(key)) }
  const called = vi.fn()
  const scheduler = createRafScheduler(called, owner)
  scheduler.schedule(1); scheduler.schedule(2); scheduler.schedule(3)
  expect(frames.size).toBe(1)
  const tick = (): void => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(10)) }
  tick()
  expect(called).toHaveBeenLastCalledWith(3)
  scheduler.schedule(4); scheduler.flush()
  expect(called).toHaveBeenLastCalledWith(4)
  expect(frames.size).toBe(0)
  scheduler.schedule(5); scheduler.cancel(); tick()
  expect(called).toHaveBeenCalledTimes(2)
  const loop = createRafScheduler(() => loop.schedule(), owner)
  loop.schedule(); tick()
  expect(frames.size).toBe(1)
  loop.cancel()
  expect(frames.size).toBe(0)
})
