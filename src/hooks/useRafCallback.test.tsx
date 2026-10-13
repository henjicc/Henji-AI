// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useRafCallback } from './useRafCallback'
afterEach(cleanup)
it('回调总读最新参数和闭包，切宿主与卸载取消；StrictMode 可继续调度', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0
  const owner = { requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id }, cancelAnimationFrame: vi.fn((key: number) => frames.delete(key)) }
  const received = vi.fn()
  const view = renderHook(({ label, host }) => useRafCallback((value: number) => received(label, value), host), { initialProps: { label: 'old', host: owner }, wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode> })
  act(() => { view.result.current.schedule(1); view.result.current.schedule(2) })
  view.rerender({ label: 'new', host: owner })
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)) })
  expect(received).toHaveBeenCalledOnce()
  expect(received).toHaveBeenLastCalledWith('new', 2)
  view.result.current.schedule(3)
  const other = { ...owner, cancelAnimationFrame: vi.fn((key: number) => frames.delete(key)) }
  view.rerender({ label: 'new', host: other })
  expect(frames.size).toBe(0)
  expect(owner.cancelAnimationFrame).toHaveBeenCalled()
  view.result.current.schedule(4)
  view.unmount()
  expect(frames.size).toBe(0)
  expect(other.cancelAnimationFrame).toHaveBeenCalled()
})
