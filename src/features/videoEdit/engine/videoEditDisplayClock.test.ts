import { expect, it } from 'vitest'
import { alignVideoEditClockToDisplay, videoEditLiveFrame } from './videoEditDisplayClock'

it('播放时钟起点挪到两次刷新正中间，只往后挪且不超过一个周期', () => {
  const period = 1000 / 60
  for (const target of [100, 100.4, 108.3, 116.6, 250]) {
    const aligned = alignVideoEditClockToDisplay(target, 100, period)
    expect(aligned).toBeGreaterThanOrEqual(target); expect(aligned - target).toBeLessThan(period)
    expect((((aligned - 100) % period) + period) % period).toBeCloseTo(period / 2, 6)
  }
  // A refresh stamp after the target works the same (phase is periodic).
  expect(alignVideoEditClockToDisplay(100, 150, period)).toBeCloseTo(100 + period / 2, 6)
})

it('示范即时重画不推进未来帧，慢速、倒放和起播预留时间均沿同一播放时钟', () => {
  expect(videoEditLiveFrame(20, -100, 30, .5, 1, 300)).toBe(20)
  expect(videoEditLiveFrame(20, 60, 30, .5, 1, 300)).toBe(20)
  expect(videoEditLiveFrame(20, 1000, 30, .5, 1, 300)).toBe(35)
  expect(videoEditLiveFrame(20, 1000, 30, .25, 1, 300)).toBe(27)
  expect(videoEditLiveFrame(20, 1000, 30, .5, -1, 300)).toBe(5)
  expect(videoEditLiveFrame(20, 10000, 30, 1, -1, 300)).toBe(0)
  expect(videoEditLiveFrame(20, 10000, 30, 1, 1, 300)).toBe(299)
})
