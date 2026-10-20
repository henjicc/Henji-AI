import { expect, it } from 'vitest'
import { alignVideoEditClockToDisplay, followVideoEditAudioClock, videoEditAudioClockOrigin, videoEditLiveFrame, videoEditPlaybackTarget } from './videoEditDisplayClock'

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

it('正向播放跟得上时逐帧前进，落后于时钟时跳到下一张来得及呈现的帧，不越过片尾', () => {
  expect(videoEditPlaybackTarget(11, 9, 0, 600)).toBe(11)
  expect(videoEditPlaybackTarget(11, 10, 0, 600)).toBe(11)
  expect(videoEditPlaybackTarget(11, 11, 0, 600)).toBe(11)
  expect(videoEditPlaybackTarget(11, 12, 0, 600)).toBe(13)
  expect(videoEditPlaybackTarget(11, 14, 0, 600)).toBe(15)
  expect(videoEditPlaybackTarget(11, 900, 0, 600)).toBe(599)
  expect(videoEditPlaybackTarget(3, -1, 5, 600)).toBe(5)
})

it('画面时钟以声音实际输出为准：换算含输出延迟的起点，大偏差对齐、小偏差缓慢跟随', () => {
  // 起点声音排在 AudioContext 的 2.0 秒；此刻（performance 1000ms）扬声器正在播 1.95 秒的样本 → 起点在 1050ms 被听到。
  expect(videoEditAudioClockOrigin({ contextTime: 1.95, performanceTime: 1000 }, 2, 1000)).toBeCloseTo(1050)
  expect(videoEditAudioClockOrigin({ contextTime: 1.95, performanceTime: 990 }, 2, 1000)).toBeCloseTo(1040)
  expect(videoEditAudioClockOrigin({ contextTime: 0, performanceTime: 0 }, 2, 1000)).toBeUndefined()
  const period = 1000 / 60
  expect(followVideoEditAudioClock(1000, 1010, period, 0)).toBe(1000)
  expect(followVideoEditAudioClock(1000, 984, period, 0)).toBe(1000)
  const snapped = followVideoEditAudioClock(1000, 1040, period, 0)
  expect(snapped).toBeGreaterThanOrEqual(1040); expect(snapped - 1040).toBeLessThan(period)
  expect(((snapped % period) + period) % period).toBeCloseTo(period / 2, 6)
  expect(followVideoEditAudioClock(1000, 1040, period)).toBe(1040)
})
