// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { createStore } from 'zustand/vanilla'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStoreAttachment } from './storeAttachment'

afterEach(cleanup)

function setup() {
  const owner = createStore(() => ({ value: 0 }))
  const attachment = createStoreAttachment(owner)
  const selector = vi.fn((state: { value: number }) => state.value)
  const view = renderHook(() => attachment.useAttachedStore(selector))
  selector.mockClear()
  return { owner, attachment, selector, view }
}

describe('store attachment 的同步界面通知合并', () => {
  it('自定义比较的界面订阅也只读取批次最终值，并保留等值投影和工程切换', () => {
    const owner = createStore(() => ({ value: 0, unrelated: 0 }))
    const attachment = createStoreAttachment(owner)
    const selector = vi.fn((state: { value: number }) => [state.value])
    const view = renderHook(() => useStoreWithEqualityFn(attachment.viewStore, selector,
      (a, b) => a[0] === b[0]))
    const transitions: number[] = []
    const stop = attachment.useAttachedStore.subscribe(state => transitions.push(state.value))
    selector.mockClear()
    act(() => attachment.batchViewUpdates(() => {
      owner.setState({ value: 1 })
      owner.setState({ value: 2 })
      expect(selector).not.toHaveBeenCalled()
      expect(transitions).toEqual([1, 2])
    }))
    expect(view.result.current).toEqual([2])
    const previous = view.result.current
    act(() => owner.setState({ unrelated: 1 }))
    expect(view.result.current).toBe(previous)
    const next = createStore(() => ({ value: 40, unrelated: 0 }))
    act(() => attachment.attach(next))
    expect(view.result.current).toEqual([40])
    act(() => owner.setState({ value: 3 }))
    expect(view.result.current).toEqual([40])
    stop()
    view.unmount()
    selector.mockClear()
    act(() => next.setState({ value: 41 }))
    expect(selector).not.toHaveBeenCalled()
  })

  it('合并界面检查但保留每次领域通知和即时读取', () => {
    const { owner, attachment, selector, view } = setup()
    const transitions: number[] = []
    const stop = attachment.useAttachedStore.subscribe(state => transitions.push(state.value))
    act(() => attachment.batchViewUpdates(() => {
      for (let value = 1; value <= 20; value++) {
        owner.setState({ value })
        expect(attachment.useAttachedStore.getState().value).toBe(value)
        expect(transitions).toHaveLength(value)
      }
      expect(selector).not.toHaveBeenCalled()
    }))
    expect(view.result.current).toBe(20)
    expect(selector).toHaveBeenCalled()
    stop()
    act(() => owner.setState({ value: 21 }))
    expect(view.result.current).toBe(21)
    expect(transitions).toHaveLength(20)
  })

  it('嵌套与异常都在最外层退出时发布，之后更新仍正常', () => {
    const { owner, attachment, selector, view } = setup()
    act(() => {
      expect(() => attachment.batchViewUpdates(() => {
        owner.setState({ value: 1 })
        attachment.batchViewUpdates(() => owner.setState({ value: 2 }))
        expect(selector).not.toHaveBeenCalled()
        throw new Error('write failed')
      })).toThrow('write failed')
    })
    expect(view.result.current).toBe(2)
    act(() => owner.setState({ value: 3 }))
    expect(view.result.current).toBe(3)
    selector.mockClear()
    act(() => attachment.batchViewUpdates(() => {}))
    expect(selector).not.toHaveBeenCalled()
  })

  it('异步回调只合并 await 之前的同步工作，不阻塞等待期间的更新', async () => {
    const { owner, attachment, view } = setup()
    let resume!: () => void
    const ready = new Promise<void>(resolve => { resume = resolve })
    let pending!: Promise<void>
    act(() => { pending = attachment.batchViewUpdates(async () => {
      owner.setState({ value: 1 })
      await ready
      owner.setState({ value: 3 })
    }) })
    expect(view.result.current).toBe(1)
    act(() => owner.setState({ value: 2 }))
    expect(view.result.current).toBe(2)
    await act(async () => { resume(); await pending })
    expect(view.result.current).toBe(3)
  })

  it('批次内切换工程只显示新工程，旧工程后续写入不会污染新工程', () => {
    const { owner, attachment, view, selector } = setup()
    const next = createStore(() => ({ value: 40 }))
    act(() => attachment.batchViewUpdates(() => {
      owner.setState({ value: 1 })
      attachment.attach(next)
      owner.setState({ value: 2 })
      next.setState({ value: 41 })
    }))
    expect(view.result.current).toBe(41)
    expect(owner.getState().value).toBe(2)
    view.unmount()
    selector.mockClear()
    expect(() => attachment.batchViewUpdates(() => next.setState({ value: 42 }))).not.toThrow()
    expect(selector).not.toHaveBeenCalled()
  })
})
