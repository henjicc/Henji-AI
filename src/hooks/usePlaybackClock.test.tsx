// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { usePlaybackClock } from './usePlaybackClock'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('单个播放循环，暂停/离屏/换源/卸载清理，按所属窗口读取媒体时钟', () => {
  const audio = document.createElement('audio')
  const mediaRef = { current: audio }
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const view = renderHook(({ playing, enabled, source }) => usePlaybackClock(mediaRef, playing, source, enabled), { initialProps: { playing: true, enabled: true, source: 'a' } })
  expect(frames.size).toBe(1)
  audio.currentTime = 12
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)) })
  expect(view.result.current.store.getState().currentTime).toBe(12)
  expect(frames.size).toBe(1)
  view.rerender({ playing: true, enabled: false, source: 'a' })
  expect(frames.size).toBe(0)
  view.rerender({ playing: false, enabled: true, source: 'b' })
  view.result.current.setTime(2)
  expect(view.result.current.store.getState().currentTime).toBe(2)
  view.rerender({ playing: true, enabled: true, source: 'b' })
  expect(frames.size).toBe(1)
  view.unmount()
  expect(frames.size).toBe(0)
})
