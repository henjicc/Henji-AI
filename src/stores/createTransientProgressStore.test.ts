// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createTransientProgressStore, type TransientProgressActions } from './createTransientProgressStore'
afterEach(cleanup)
it('共享工厂自定义比较、规范化、批量清理与按键叶子订阅', () => {
  type State = TransientProgressActions<number> & { entries: ReadonlyMap<string, number> }
  const progress = createTransientProgressStore<number, State>({
    initialState: actions => ({ ...actions, entries: new Map() }),
    getEntry: (state, id) => state.entries.get(id),
    entries: state => state.entries,
    patch: entries => ({ entries }),
    normalize: value => Math.max(0, Math.min(1, value)),
    equals: (a, b) => Math.abs(a - b) < 0.01,
  })
  const rendered = vi.fn()
  const leaf = renderHook(() => { const value = progress.useEntry('a'); rendered(); return value })
  const initial = rendered.mock.calls.length
  act(() => progress.store.getState().set('b', 2))
  expect(rendered.mock.calls.length).toBe(initial)
  act(() => progress.store.getState().set('a', 0.3))
  expect(leaf.result.current).toBe(0.3)
  const notify = vi.fn(); const unsubscribe = progress.store.subscribe(notify)
  progress.store.getState().set('a', 0.301)
  progress.store.getState().clear(['missing'])
  progress.store.getState().set('missing', null)
  expect(notify).not.toHaveBeenCalled()
  act(() => progress.store.getState().clear(['a', 'b']))
  expect(progress.store.getState().entries.size).toBe(0)
  expect(leaf.result.current).toBeUndefined()
  expect(notify).toHaveBeenCalledOnce()
  progress.store.getState().clearAll()
  expect(notify).toHaveBeenCalledOnce()
  unsubscribe()
})
