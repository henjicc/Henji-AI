import { afterEach, expect, it, vi } from 'vitest'
import { USER_CONFIRMATION_TIMEOUT_MS } from '@/core/application-control/userConfirmation'
import { requestAlertConfirmation, useAlertDialogStore } from './alertDialogStore'

afterEach(() => { useAlertDialogStore.setState({ queue: [] }); vi.useRealTimers() })
it('界面付费确认到期自动关闭并拒绝，保留队列中其他提示', async () => {
  vi.useFakeTimers()
  const result = requestAlertConfirmation({ title: '生成', message: '计费', confirmLabel: '允许本次', paidConfirmation: true })
  useAlertDialogStore.getState().show({ title: '其他提示', message: '保留' })
  await vi.advanceTimersByTimeAsync(USER_CONFIRMATION_TIMEOUT_MS)
  expect(useAlertDialogStore.getState().queue.map(item => item.title)).toEqual(['其他提示'])
  expect(await result).toBe(false)
})
it.each(['confirm', 'cancel', 'abort'])('付费确认 %s 后清理计时器', async action => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const result = requestAlertConfirmation({ title: '生成', message: '计费', confirmLabel: '允许', paidConfirmation: true }, controller.signal)
  if (action === 'confirm') useAlertDialogStore.getState().confirmCurrent()
  else if (action === 'cancel') useAlertDialogStore.getState().dismissCurrent()
  else controller.abort()
  expect(await result).toBe(action === 'confirm')
  expect(useAlertDialogStore.getState().queue).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})
it('系统时钟越过期限但定时器尚未执行时，迟到点击仍拒绝', async () => {
  vi.useFakeTimers()
  const result = requestAlertConfirmation({ title: '生成', message: '计费', confirmLabel: '允许', paidConfirmation: true })
  vi.setSystemTime(Date.now() + USER_CONFIRMATION_TIMEOUT_MS)
  useAlertDialogStore.getState().confirmCurrent()
  expect(await result).toBe(false)
})
