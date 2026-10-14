import { expect, it } from 'vitest'
import { CaptureFrameClock } from './frameClock'
it('校准每五秒发生，漂移修正限制在一帧且时间不倒退', () => {
  const clock = new CaptureFrameClock()
  expect(clock.needsCalibration(10_000_000)).toBe(true)
  clock.calibrate(10_000_000, 1_000_000, 16667)
  expect(clock.map(10_000_000)).toBe(1_000_000)
  expect(clock.needsCalibration(14_999_999)).toBe(false)
  expect(clock.needsCalibration(15_000_000)).toBe(true)
  clock.calibrate(15_000_000, 9_000_000, 16667)
  expect(clock.map(15_000_000)).toBe(6_016_667)
  clock.calibrate(15_000_000, 0, 16667)
  expect(clock.map(15_000_000)).toBe(6_016_668)
})
