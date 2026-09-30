import { expect, it } from 'vitest'
import { withMediaHeavyTask } from './concurrency'

it('媒体任务始终最多两个；取消排队不会占用或泄漏执行名额', async () => {
  let active = 0; let peak = 0
  const finishes: Array<() => void> = []
  const task = (): Promise<void> => withMediaHeavyTask(async () => {
    active++; peak = Math.max(peak, active)
    await new Promise<void>(resolve => finishes.push(resolve)); active--
  })
  const first = task(); const second = task()
  await Promise.resolve()
  const cancel = new AbortController()
  let cancelledRan = false
  const cancelled = withMediaHeavyTask(async () => { cancelledRan = true }, cancel.signal).catch(error => error)
  const third = task(); const fourth = task()
  cancel.abort(new Error('不再可见'))
  expect(await cancelled).toBe(cancel.signal.reason)
  expect(cancelledRan).toBe(false)
  expect(finishes).toHaveLength(2)
  finishes[0](); await first; await Promise.resolve()
  expect(finishes).toHaveLength(3); expect(active).toBe(2)
  finishes[1](); await second; await Promise.resolve()
  expect(finishes).toHaveLength(4); expect(active).toBe(2)
  finishes[2](); finishes[3](); await Promise.all([third, fourth])
  await withMediaHeavyTask(async () => { expect(active).toBe(0) })
  expect(peak).toBe(2)
})
