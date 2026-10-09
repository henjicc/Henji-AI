import { describe, expect, it, vi } from 'vitest'
import { InteractionLifecycle } from '@/core/imaging/interaction/lifecycle'
import type { InteractionCancelReason, InteractionGesture, InteractionPointerInput } from '@/core/imaging/interaction/contracts'

const input = (phase: InteractionPointerInput['phase'], x = 10, pointerId = 1): InteractionPointerInput => {
  const sample = { pointerId, pointerType: 'pen', client: { x, y: 12 }, point: { x, y: 12 }, pressure: 0.5, tiltX: 25, tiltY: -5, twist: 45, timestamp: 123 }
  return { phase, sample, samples: [sample], time: { kind: 'sample', sourceVersion: 'clip-source', ticks: 48, ticksPerSecond: 24 } }
}
const gesture = (): InteractionGesture => ({ begin: vi.fn(), preview: vi.fn(), commit: vi.fn(), cancel: vi.fn() })

describe('共享手势生命周期', () => {
  it('单指针租约保留压力/倾角/源时间及末尾点，完成只提交一次', async () => {
    const lifecycle = new InteractionLifecycle(), tool = gesture()
    expect(lifecycle.begin(tool, input('down'))).toBe(true)
    expect(lifecycle.begin(gesture(), input('down', 30, 2))).toBe(false)
    expect(lifecycle.preview(input('move', 30, 2))).toBe(false)
    lifecycle.preview(input('move', 25))
    const final = input('up', 40)
    expect(await lifecycle.commit(final)).toBe(true)
    expect(tool.commit).toHaveBeenCalledTimes(1)
    expect(tool.commit).toHaveBeenCalledWith(final)
    expect(lifecycle.phase).toBe('idle')
    expect(await lifecycle.commit(final)).toBe(false)
  })
  it.each<InteractionCancelReason>(['escape', 'pointercancel', 'lostcapture', 'blur', 'tool-change', 'temporary-tool', 'target-change', 'unmount', 'failed'])('%s 只取消一次，不留下捕获或提交', reason => {
    const lifecycle = new InteractionLifecycle(), tool = gesture()
    lifecycle.begin(tool, input('down'))
    expect(lifecycle.cancel(reason)).toBe(true)
    expect(lifecycle.cancel(reason)).toBe(false)
    expect(tool.cancel).toHaveBeenCalledTimes(1)
    expect(tool.cancel).toHaveBeenCalledWith(reason)
    expect(tool.commit).not.toHaveBeenCalled()
    expect(lifecycle.pointerId).toBeNull()
  })
  it('同步无操作立即释放；异步取消后迟到完成不清掉新手势', async () => {
    const lifecycle = new InteractionLifecycle(), noop = gesture()
    lifecycle.begin(noop, input('down'))
    const first = lifecycle.commit(input('up'))
    expect(lifecycle.phase).toBe('idle')
    await first
    let complete: (() => void) | undefined
    const tool = gesture()
    tool.commit = () => new Promise<void>(resolve => { complete = resolve })
    lifecycle.begin(tool, input('down'))
    const pending = lifecycle.commit(input('up'))
    expect(lifecycle.phase).toBe('committing')
    lifecycle.cancel('target-change')
    lifecycle.begin(gesture(), input('down', 50, 2))
    complete!()
    expect(await pending).toBe(false)
    expect(lifecycle.pointerId).toBe(2)
  })
  it('切帧或替换源版本取消原手势，不能把参考帧操作提交到另一个时间样本', async () => {
    const lifecycle = new InteractionLifecycle(), tool = gesture()
    lifecycle.begin(tool, input('down'))
    const changed = input('up')
    changed.time = { kind: 'sample', sourceVersion: 'clip-source', ticks: 49, ticksPerSecond: 24 }
    expect(await lifecycle.commit(changed)).toBe(false)
    expect(tool.cancel).toHaveBeenCalledWith('target-change')
    expect(tool.commit).not.toHaveBeenCalled()
  })
})
