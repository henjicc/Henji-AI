import { expect, it } from 'vitest'
import { videoEditMeasuredRenderState, videoEditRenderPerformance } from './renderPerformance'

it('样本足够后覆盖启发式，跳帧严格超过5%才标红，单帧耗时超预算但按时呈现不算，p90只用呈现的帧', () => {
  const measure = (samples: Array<number | null>) => videoEditRenderPerformance({ fps: 60, updatedAt: 0, samples })
  expect(videoEditMeasuredRenderState(true, measure([100]))).toBe('predicted')
  expect(videoEditMeasuredRenderState(false)).toBe('realtime')
  const smooth = measure([...Array<number>(19).fill(30), null])
  expect(smooth).toEqual({ sampleFrames: 20, droppedFrames: 1, p90Ms: 30 })
  expect(videoEditMeasuredRenderState(true, smooth)).toBe('realtime')
  const dropped = measure([...Array<number>(14).fill(5), 20, 20, 20, null, null, null])
  expect(dropped.p90Ms).toBe(20)
  expect(videoEditMeasuredRenderState(false, dropped)).toBe('dropped')
})
