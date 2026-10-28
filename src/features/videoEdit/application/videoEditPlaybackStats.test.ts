import { describe, expect, it, vi } from 'vitest'
import { VideoEditTimingHistogram, type VideoEditTimingDistribution } from '../engine/videoEditTimingHistogram'

vi.mock('./videoEditService', () => ({ listVideoEditInstances: () => [], subscribeVideoEditView: () => () => {}, videoEditProgramCommandIdentity: () => ({}) }))
const { VideoEditPlaybackCollector } = await import('./videoEditPlaybackStats')

/** 直方图分位数的相对误差上限是 1%（再加两位小数的取整）。 */
function expectNear(actual: VideoEditTimingDistribution, expected: { count: number; p50: number; p95: number; max: number }): void {
  expect(actual.count).toBe(expected.count)
  expect(actual.max).toBe(expected.max)
  for (const key of ['p50', 'p95'] as const) expect(Math.abs(actual[key]! - expected[key])).toBeLessThanOrEqual(expected[key] * 0.01 + 0.005)
}

describe('节目播放统计', () => {
  it('P50/P95 按最近秩落桶，相对误差不超过 1%；最大值精确；内存不随样本数增长', () => {
    const histogram = new VideoEditTimingHistogram()
    for (let index = 1; index <= 20; index++) histogram.add(index)
    expectNear(histogram.distribution(), { count: 20, p50: 10, p95: 19, max: 20 })
    const zeros = new VideoEditTimingHistogram()
    for (const ms of [0, 0, 0, 7, Number.NaN]) zeros.add(ms)
    expect(zeros.distribution()).toEqual({ count: 4, p50: 0, p95: 7, max: 7 })
    expect(new VideoEditTimingHistogram().distribution()).toEqual({ count: 0, p50: null, p95: null, max: null })
    const long = new VideoEditTimingHistogram()
    for (let index = 0; index < 200_000; index++) long.add(4 + (index % 1000) / 100)
    expect((long as unknown as { buckets: Map<number, number> }).buckets.size).toBeLessThan(80)
    expectNear(long.distribution(), { count: 200_000, p50: 8.99, p95: 13.49, max: 13.99 })
  })

  it('起播帧只作起点，帧间空缺记为跳帧，迟到的帧忽略', () => {
    const collector = new VideoEditPlaybackCollector(100, 0)
    expect(collector.add(101, { presented: true, renderCached: false, renderElapsedMs: 8, renderStages: { 'gpu.frame': 5, decode: 0 } }, 20)).toBe(true)
    expect(collector.add(104, { presented: true, renderCached: false, renderElapsedMs: 12, renderStages: { 'gpu.frame': 9 } }, 30)).toBe(true)
    expect(collector.add(105, { presented: true, renderCached: true }, 10)).toBe(true)
    expect(collector.add(103, { presented: true, renderCached: false, renderElapsedMs: 99 }, 99)).toBe(false)
    const summary = collector.summary(1000)
    expect(summary).toMatchObject({ startFrame: 100, endFrame: 105, expectedFrames: 6, presentedFrames: 4, droppedFrames: 2, droppedRatio: 0.333333, maxConsecutiveDropped: 2, cachedFrames: 1, durationMs: 1000 })
    expectNear(summary.renderMs, { count: 2, p50: 8, p95: 12, max: 12 })
    expectNear(summary.presentLatencyMs, { count: 3, p50: 20, p95: 30, max: 30 })
    expect(Object.keys(summary.stages)).toEqual(['gpu.frame'])
    expectNear(summary.stages['gpu.frame'], { count: 2, p50: 5, p95: 9, max: 9 })
  })
})
