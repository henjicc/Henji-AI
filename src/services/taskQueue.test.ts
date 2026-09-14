// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { taskQueueManager } from './taskQueue'
import { APPLICATION_SETTINGS_CHANGED_EVENT } from '@/core/settings/events'

it('并发设置修改立即释放等待项，降低限制不取消已执行任务', async () => {
  const releases: Array<() => void> = []
  const started: number[] = []
  const setLimit = (value: number) => {
    localStorage.setItem('max_concurrent_tasks', String(value))
    window.dispatchEvent(new Event(APPLICATION_SETTINGS_CHANGED_EVENT))
  }
  setLimit(1)
  for (let index = 0; index < 3; index++) taskQueueManager.enqueue({ id: `setting-${index}`, providerId: 'kie', execute: () => {
    started.push(index)
    return new Promise<void>(resolve => releases.push(resolve))
  } })
  expect(started).toEqual([0])
  setLimit(2)
  expect(started).toEqual([0, 1])
  setLimit(1)
  releases[0](); await Promise.resolve(); await Promise.resolve()
  expect(started).toEqual([0, 1])
  releases[1](); await Promise.resolve(); await Promise.resolve()
  expect(started).toEqual([0, 1, 2])
  releases[2](); await Promise.resolve(); await Promise.resolve()
  setLimit(2)
})
