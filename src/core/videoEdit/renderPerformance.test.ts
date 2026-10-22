import { expect, it } from 'vitest'
import { videoEditMeasuredRenderState, videoEditRenderPerformance } from './renderPerformance'

it('样本足够后覆盖启发式，严格超过5%才标红，p90使用实际样本', () => {
  const measure = (samples: number[]) => videoEditRenderPerformance({ fps: 60, updatedAt: 0, samples })
  expect(videoEditMeasuredRenderState(true, measure([100]))).toBe('predicted')
  expect(videoEditMeasuredRenderState(false)).toBe('realtime')
  const smooth = measure([...Array<number>(19).fill(5), 100])
  expect(smooth).toEqual({ sampleFrames: 20, overBudgetFrames: 1, p90Ms: 5 })
  expect(videoEditMeasuredRenderState(true, smooth)).toBe('realtime')
  const dropped = measure([...Array<number>(17).fill(5), 20, 30, 100])
  expect(dropped.p90Ms).toBe(20)
  expect(videoEditMeasuredRenderState(false, dropped)).toBe('dropped')
})
