// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UI_DURATION } from '@/components/ui/motion'
import { useMultiAngleTransition } from './useMultiAngleTransition'

let now = 0
let nextId = 0
let reduced = false
const frames = new Map<number, FrameRequestCallback>()
const step = (ms: number): void => {
  now += ms
  const callbacks = [...frames.values()]
  frames.clear()
  act(() => callbacks.forEach(callback => callback(now)))
}
beforeEach(() => {
  now = 0; nextId = 0; reduced = false; frames.clear()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('有限时长的方位切换动画', () => {
  it('闲置不调度；中途换方向从当前位置继续，结束与卸载清空回调', () => {
    const { result, rerender, unmount } = renderHook(({ azimuth }) => useMultiAngleTransition({ azimuth, elevation: 0 }, true), { initialProps: { azimuth: 0 } })
    expect(frames.size).toBe(0)
    rerender({ azimuth: 90 })
    expect(result.current.azimuth).toBe(0)
    step(0)
    step(80)
    const middle = result.current.azimuth
    expect(middle).toBeGreaterThan(0); expect(middle).toBeLessThan(90)
    rerender({ azimuth: -90 })
    expect(result.current.azimuth).toBe(middle)
    expect(frames.size).toBe(1)
    step(0)
    step(UI_DURATION.slow)
    expect(result.current.azimuth).toBe(-90)
    expect(frames.size).toBe(0)
    rerender({ azimuth: 0 })
    unmount()
    expect(frames.size).toBe(0)
  })
  it('跨越背面走短路径；拖动接管时直接跟随，不保留动画', () => {
    let renders = 0
    const { result, rerender } = renderHook(({ azimuth, enabled }) => {
      renders++
      return useMultiAngleTransition({ azimuth, elevation: 0 }, enabled)
    }, { initialProps: { azimuth: 170, enabled: true } })
    rerender({ azimuth: -170, enabled: true })
    step(0)
    step(80)
    expect(result.current.azimuth).toBeGreaterThan(170)
    const middle = result.current.azimuth
    rerender({ azimuth: middle, enabled: false })
    expect(result.current.azimuth).toBe(middle)
    expect(frames.size).toBe(0)
    const beforeDrag = renders
    rerender({ azimuth: 42, enabled: false })
    expect(result.current.azimuth).toBe(42)
    expect(renders - beforeDrag).toBe(1)
    rerender({ azimuth: 45, enabled: true })
    expect(result.current.azimuth).toBe(42)
    step(0)
    step(UI_DURATION.slow)
    expect(result.current.azimuth).toBe(45)
    expect(frames.size).toBe(0)
  })
  it('减少动态效果时直接到位，不启动帧循环', () => {
    reduced = true
    const { result, rerender } = renderHook(({ azimuth }) => useMultiAngleTransition({ azimuth, elevation: 30 }, true), { initialProps: { azimuth: 0 } })
    rerender({ azimuth: 90 })
    expect(result.current).toEqual({ azimuth: 90, elevation: 30 })
    expect(frames.size).toBe(0)
  })
})
