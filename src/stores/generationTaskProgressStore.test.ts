import { afterEach, expect, it, vi } from 'vitest'
import { useGenerationTaskProgressStore as store } from './generationTaskProgressStore'
afterEach(() => store.getState().clearAllProgress())
it('同值、钳制后同值和无命中清理不通知', () => {
  store.getState().setProgress('task', 100)
  const notify = vi.fn()
  const unsubscribe = store.subscribe(notify)
  store.getState().setProgress('task', 100.2)
  store.getState().setProgress('task', 99.8)
  store.getState().setProgress('missing', null)
  store.getState().clearProgress('missing')
  expect(notify).not.toHaveBeenCalled()
  store.getState().clearProgress('task')
  expect(notify).toHaveBeenCalledTimes(1)
  store.getState().clearAllProgress()
  expect(notify).toHaveBeenCalledTimes(1)
  unsubscribe()
})
