/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useShallow } from 'zustand/react/shallow'
vi.mock('@/commands/logging', () => ({ listenLogEvent: vi.fn().mockResolvedValue(() => undefined) }))
import { logWindowStore, useLogWindowStore } from './logStore'

afterEach(() => { cleanup(); logWindowStore.clear(); logWindowStore.setPaused(false) })

it('未改变的 selector 不重绘，快照与控制函数保持稳定', () => {
  let renders = 0
  const hook = renderHook(() => {
    renders++
    return useLogWindowStore(useShallow(state => ({ paused: state.paused, clear: state.clear })))
  })
  const initial = hook.result.current
  const initialRenders = renders
  act(() => logWindowStore.clear())
  expect(renders).toBe(initialRenders)
  act(() => logWindowStore.setPaused(true))
  expect(renders).toBe(initialRenders + 1)
  expect(hook.result.current.clear).toBe(initial.clear)
  expect(hook.result.current.paused).toBe(true)
})
