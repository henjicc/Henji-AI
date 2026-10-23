import { expect, it } from 'vitest'
import { videoEditGainValues, videoEditRecordingGainDb, videoEditGainDbSchema, videoEditGainMultiplier, videoEditLoudnessSettingsSchema, type VideoEditLoudnessMeasurement } from './loudness'
const measurement = (peak: number, lufs = -23): VideoEditLoudnessMeasurement => ({ samplePeakDbfs: peak, truePeakDbtp: peak + 1, integratedLufs: lufs, shortTermLufs: lufs, durationSeconds: 5 })
it('录后匹配 -16 LUFS，真峰值优先，最多 +30 dB，静音和短片段不变', () => {
  expect(videoEditRecordingGainDb(0, measurement(-12, -20))).toBe(4)
  expect(videoEditRecordingGainDb(0, measurement(-2, -20))).toBe(0)
  expect(videoEditRecordingGainDb(0, measurement(-40, -35))).toBe(19)
  expect(videoEditRecordingGainDb(0, measurement(-65, -60))).toBe(30)
  expect(videoEditRecordingGainDb(0, measurement(-2, 10))).toBe(-26)
  expect(videoEditRecordingGainDb(7, { ...measurement(-30), integratedLufs: null })).toBe(7)
  expect(videoEditRecordingGainDb(7, { ...measurement(-30), durationSeconds: .399 })).toBe(7)
  expect(videoEditRecordingGainDb(7, { ...measurement(-30), durationSeconds: .4 })).toBe(7)
})
it('设置与调整独立 dB，整个计算先校验范围，不受音量倍率上限影响', () => {
  expect(videoEditGainValues('set', 18, [-3, 6])).toEqual([18, 18])
  expect(videoEditGainValues('adjust', 12, [-3, 6])).toEqual([9, 18])
  expect(() => videoEditGainValues('adjust', 6, [0, 92])).toThrow('-96～+96')
  expect(videoEditGainDbSchema.safeParse(96).success).toBe(true)
  expect(videoEditGainDbSchema.safeParse(-96).success).toBe(true)
  expect(videoEditGainDbSchema.safeParse(96.1).success).toBe(false)
  expect(videoEditGainMultiplier(20)).toBe(10)
  expect(videoEditGainMultiplier()).toBe(1)
})
it('源测量标准化不累加旧增益，最大峰值共同增益，所有峰值分别对齐', () => {
  const measured = [measurement(-20, -35), measurement(-26, -41)]
  expect(videoEditGainValues('peak_max', -1, [5, -3], measured)).toEqual([19, 19])
  expect(videoEditGainValues('peak_all', -1, [5, -3], measured)).toEqual([19, 25])
  expect(videoEditGainValues('loudness', -16, [5, -3], measured)).toEqual([19, 25])
})
it('无响度不能冒充零，非法目标拒绝', () => {
  expect(() => videoEditGainValues('loudness', -14, [0], [{ ...measurement(-20), integratedLufs: null }])).toThrow('静音')
  expect(() => videoEditGainValues('set', NaN, [0])).toThrow('有限')
  expect(videoEditLoudnessSettingsSchema.safeParse({ targetLufs: -14, truePeakDbtp: -1 }).success).toBe(true)
})
