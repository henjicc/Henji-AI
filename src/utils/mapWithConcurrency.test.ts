import { expect, it } from 'vitest'
import { mapWithConcurrency } from './mapWithConcurrency'

it('按输入顺序返回结果，同时执行的任务不超过上限', async () => {
  let running = 0, peak = 0
  const results = await mapWithConcurrency([30, 5, 20, 1, 10], 2, async (delay, index) => {
    running++; peak = Math.max(peak, running)
    await new Promise(resolve => setTimeout(resolve, delay))
    running--
    return index * 10
  })
  expect(results).toEqual([0, 10, 20, 30, 40])
  expect(peak).toBe(2)
})

it('任一任务失败即整体失败，且不再领取新任务', async () => {
  const started: number[] = []
  await expect(mapWithConcurrency([1, 2, 3, 4], 1, async item => { started.push(item); if (item === 2) throw new Error('第二项失败'); return item })).rejects.toThrow('第二项失败')
  expect(started).toEqual([1, 2])
})
