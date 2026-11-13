import { expect, it } from 'vitest'
import { HookEventClock } from './hook-clock'

it('滴答比主进程时钟慢 100 ppm 录两小时：准时的事件始终用收到的时刻，卡顿后晚到的仍按真实时刻记，不越录越早', () => {
  const clock = new HookEventClock(true)
  const tick = (trueUs: number): number => Math.floor(5_000_000 + trueUs * (1 - 100e-6) / 1000)
  for (let trueUs = 0; trueUs <= 7_200_000_000; trueUs += 100_000) expect(clock.at(trueUs + 300, tick(trueUs))).toBe(trueUs + 300)
  // 两小时后主进程卡了 2 秒：卡顿期间的事件晚到，换算后与真实时刻相差不到一个滴答
  const happened = 7_200_500_000
  const recorded = clock.at(happened + 2_000_000, tick(happened))
  expect(Math.abs(recorded - happened)).toBeLessThan(2_000)
})

it('32 位滴答回绕时主进程正卡着：回绕后第一批事件就是晚到的，仍按真实时刻记', () => {
  const clock = new HookEventClock(true)
  const tick = (trueUs: number): number => (2 ** 32 - 1_000 + Math.floor(trueUs / 1000)) % 2 ** 32
  for (let trueUs = 0; trueUs <= 900_000; trueUs += 50_000) expect(clock.at(trueUs, tick(trueUs))).toBe(trueUs)
  // 滴答在 1 秒处回绕；1.2 秒发生的事件卡到 2.2 秒才送到。不认回绕的话会把它当成时钟跳变、按收到时刻记，晚 1 秒
  expect(Math.abs(clock.at(2_200_000, tick(1_200_000)) - 1_200_000)).toBeLessThan(2_000)
})

it('很久没有事件后不沿用很久以前的偏移：两个时钟的差变了，准时事件仍按收到的时刻记', () => {
  const clock = new HookEventClock(true)
  for (let trueUs = 0; trueUs <= 10_000_000; trueUs += 100_000) expect(clock.at(trueUs, 1_000 + trueUs / 1000)).toBe(trueUs)
  // 两分钟没动鼠标，期间两个时钟的差多了 80 毫秒（例如系统校时）；之后的准时事件不能被当成晚到、记早 80 毫秒
  const later = 130_000_000
  expect(clock.at(later, 1_000 + later / 1000 - 80)).toBe(later)
})

it('不换算时（macOS 的钩子时刻不是毫秒）总用收到的时刻', () => {
  const clock = new HookEventClock(false)
  expect(clock.at(1_000_000, 1)).toBe(1_000_000)
  expect(clock.at(9_000_000, 2)).toBe(9_000_000)
})
