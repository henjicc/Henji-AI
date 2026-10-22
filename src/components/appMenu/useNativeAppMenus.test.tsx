/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { contributeAppMenus } from '@/core/appMenu/appMenu'
import { useNativeAppMenus } from './useNativeAppMenus'

const mock = vi.hoisted(() => ({ update: vi.fn(async () => undefined), invoke: undefined as undefined | ((payload: { id: string }) => void), unlisten: vi.fn(), error: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ appMenu: { update: mock.update, onInvoke: (listener: typeof mock.invoke) => { mock.invoke = listener; return mock.unlisten } } }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: mock.error }) }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

it('50ms 合并更新，聚焦重新同步；执行最新可用命令并记录同步与异步错误', async () => {
  vi.useFakeTimers()
  const run = vi.fn(() => { throw new Error('失败') })
  let remove = contributeAppMenus('native-test', [{ menu: 'edit', items: [{ kind: 'action', id: 'test.undo', label: '撤销', run }] }])
  const hook = renderHook(() => useNativeAppMenus(true))
  await act(async () => { await vi.advanceTimersByTimeAsync(49) })
  expect(mock.update).not.toHaveBeenCalled()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(mock.update).toHaveBeenCalledOnce()
  mock.invoke?.({ id: 'test.undo' })
  expect(run).toHaveBeenCalledOnce()
  expect(mock.error).toHaveBeenCalledOnce()
  remove()
  mock.invoke?.({ id: 'test.undo' })
  expect(run).toHaveBeenCalledOnce()
  remove = contributeAppMenus('native-test', [{ menu: 'edit', items: [{ kind: 'action', id: 'test.undo', label: '撤销', disabledReason: '不可用', run }] }])
  mock.invoke?.({ id: 'test.undo' })
  expect(run).toHaveBeenCalledOnce()
  remove()
  remove = contributeAppMenus('native-test', [{ menu: 'edit', items: [{ kind: 'action', id: 'test.undo', label: '撤销', run: () => Promise.reject(new Error('异步失败')) }] }])
  await act(async () => { mock.invoke?.({ id: 'test.undo' }) })
  expect(mock.error).toHaveBeenCalledTimes(2)
  window.dispatchEvent(new Event('focus'))
  await act(async () => { await vi.advanceTimersByTimeAsync(50) })
  expect(mock.update).toHaveBeenCalledTimes(2)
  hook.unmount(); remove()
  expect(mock.unlisten).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(100)
  expect(mock.update).toHaveBeenCalledTimes(2)
})

it('非 macOS 不建立同步订阅', () => {
  renderHook(() => useNativeAppMenus(false))
  expect(mock.update).not.toHaveBeenCalled()
})
