import { expect, it } from 'vitest'
import { SpeechEnergyHistogram, SpeechEnergyValleys } from './speechEnergy'

it('录音增益改变时自适应阈值随之改变，静音不抬高语音参考电平', () => {
  for (const level of [-20, -45]) {
    const histogram = new SpeechEnergyHistogram()
    for (let index = 0; index < 1000; index++) histogram.add(index < 800 ? -Infinity : level)
    expect(histogram.threshold(22)).toBe(level - 22)
  }
  expect(new SpeechEnergyHistogram().threshold(22)).toBe(-80)
})

it('低音量高频尾音打断低谷，不合并跨过辅音的两段静音', () => {
  const valleys = new SpeechEnergyValleys(-42, -60)
  for (let index = 0; index < 25; index++) valleys.append(index * 10, (index + 1) * 10, -60, index === 12 ? -50 : -90)
  valleys.flush()
  expect(valleys.pauses).toEqual([{ startMs: 0, endMs: 120, cutMs: 60 }, { startMs: 130, endMs: 250, cutMs: 190 }])
})

it('丢失的采样区间不能作为静音，短于100毫秒的低谷不输出', () => {
  const valleys = new SpeechEnergyValleys(-42, -60)
  valleys.append(0, 90, -Infinity, -Infinity)
  valleys.append(200, 305, -Infinity, -Infinity)
  valleys.flush()
  expect(valleys.pauses).toEqual([{ startMs: 200, endMs: 305, cutMs: 252.5 }])
})
