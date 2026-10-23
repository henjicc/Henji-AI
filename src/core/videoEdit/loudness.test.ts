import { expect, it } from 'vitest'
import { videoEditGainVolumes, videoEditRecordingGainVolume, videoEditLoudnessSettingsSchema, type VideoEditLoudnessMeasurement } from './loudness'
const measurement = (peak: number, lufs = -23): VideoEditLoudnessMeasurement => ({ samplePeakDbfs: peak, truePeakDbtp: peak + 1, integratedLufs: lufs, shortTermLufs: lufs, durationSeconds: 5 })
it('录后匹配 -16 LUFS，真峰值优先且限制增益，静音和短片段不变', () => {
  expect(videoEditRecordingGainVolume(1, measurement(-12, -20))).toBeCloseTo(10 ** (4 / 20))
  expect(videoEditRecordingGainVolume(1, measurement(-2, -20))).toBe(1)
  expect(videoEditRecordingGainVolume(1, measurement(-40, -35))).toBe(2)
  expect(videoEditRecordingGainVolume(1, measurement(-2, 10))).toBeCloseTo(.1)
  expect(videoEditRecordingGainVolume(.5, { ...measurement(-30), integratedLufs: null })).toBe(.5)
  expect(videoEditRecordingGainVolume(1, { ...measurement(-30), durationSeconds: .3 })).toBe(1)
})
it('设置/调整增益复用音量倍率；静音调整保持静音，越界整组拒绝', () => {
  expect(videoEditGainVolumes('set', 0, [.3, 0])).toEqual([1, 1])
  expect(videoEditGainVolumes('adjust', -6.020599913, [1, 0])[0]).toBeCloseTo(.5)
  expect(videoEditGainVolumes('adjust', 3, [0])).toEqual([0])
  expect(() => videoEditGainVolumes('adjust', 6, [1, 2])).toThrow('+6.02')
})
it('最大峰值保持片段相对差距，所有峰值各自对齐，响度按目标差值计算', () => {
  const measured = [measurement(-6), measurement(-12, -29)]
  const maximum = videoEditGainVolumes('peak_max', -9, [1, 1], measured)
  expect(maximum[0]).toBeCloseTo(maximum[1]); expect(maximum[0]).toBeCloseTo(10 ** (-3 / 20))
  const all = videoEditGainVolumes('peak_all', -9, [1, 1], measured)
  expect(all[0]).toBeCloseTo(10 ** (-3 / 20)); expect(all[1]).toBeCloseTo(10 ** (3 / 20))
  expect(videoEditGainVolumes('loudness', -26, [1, 1], measured)).toEqual(all)
})
it('无响度和无峰值不能冒充 0；设置值为有限标准范围', () => {
  expect(() => videoEditGainVolumes('loudness', -14, [1], [{ ...measurement(-20), integratedLufs: null }])).toThrow('静音')
  expect(() => videoEditGainVolumes('set', NaN, [1])).toThrow('有限')
  expect(videoEditLoudnessSettingsSchema.safeParse({ targetLufs: -14, truePeakDbtp: -1 }).success).toBe(true)
  expect(videoEditLoudnessSettingsSchema.safeParse({ targetLufs: -4, truePeakDbtp: 1 }).success).toBe(false)
})
