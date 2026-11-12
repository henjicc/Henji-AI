import { expect, it } from 'vitest'
import { MAX_HEAVY_MEDIA_TASKS, withMediaHeavyTask } from './concurrency'

it('重型媒体任务不超过并发槽；超出的排队完成而不是被拒，取消排队不会占用或泄漏名额', async () => {
  const slots = MAX_HEAVY_MEDIA_TASKS
  let active = 0; let peak = 0
  const finishes: Array<() => void> = []
  const task = (): Promise<void> => withMediaHeavyTask(async () => {
    active++; peak = Math.max(peak, active)
    await new Promise<void>(resolve => finishes.push(resolve)); active--
  })
  const running = Array.from({ length: slots }, task)
  await Promise.resolve()
  const cancel = new AbortController()
  let cancelledRan = false
  const cancelled = withMediaHeavyTask(async () => { cancelledRan = true }, cancel.signal).catch(error => error)
  // 远多于槽数的排队请求：全部排队等待，最终都完成。
  const queued = Array.from({ length: 300 }, task)
  cancel.abort(new Error('不再可见'))
  expect(await cancelled).toBe(cancel.signal.reason)
  expect(cancelledRan).toBe(false)
  expect(finishes).toHaveLength(slots)
  for (let done = 0; done < slots + queued.length; done++) {
    while (!finishes.length) await new Promise(resolve => setTimeout(resolve, 0))
    finishes.shift()!()
    expect(active).toBeLessThanOrEqual(slots)
  }
  await Promise.all([...running, ...queued])
  await withMediaHeavyTask(async () => { expect(active).toBe(0) })
  expect(peak).toBe(slots)
})
