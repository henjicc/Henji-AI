import { expect, it } from 'vitest'
import { buildSpectrumTexture, spectrumPoolLevel, spectrumTexelAddress, sampleSpectrum, spectrumDb, spectrumPower, SPECTRUM_PEAK_WEIGHT } from './spectrogramTexture'

it('超长帧、奇数频点与声道跨页后仍逐样本对应，最大值层级保留单点峰值', () => {
  const data = { sampleRate: 48000, fftSize: 8, hop: 2, startFrame: 0, frameCount: 19, binCount: 5, channelCount: 2, values: new Uint8Array(190) }
  data.values[18 * 5 + 4] = 255; data.values[95 + 7 * 5 + 1] = 127
  const packed = buildSpectrumTexture(data, 8, 16)
  expect(packed.layers).toBeGreaterThan(1)
  for (let channel = 0; channel < 2; channel++) {
    for (let frame = 0; frame < 19; frame++) for (let bin = 0; bin < 5; bin++) {
      const index = channel * packed.channelStride + frame * 5 + bin
      const [x, y, page] = spectrumTexelAddress(index, packed.width, packed.height)
      expect(packed.values[(page * packed.width * packed.height + y * packed.width + x) * 2]).toBe(data.values[channel * 95 + frame * 5 + bin])
    }
    const peakFrame = channel ? 7 : 18, peakBin = channel ? 1 : 4
    packed.levels.forEach((level, lod) => expect(packed.values[(channel * packed.channelStride + level.offset + Math.floor(peakFrame / 2 ** lod) * level.bins + peakBin) * 2]).toBe(channel ? 127 : 255))
  }
  expect(() => buildSpectrumTexture(data, 2, 1)).toThrow('上限')
})

it('池化范围在任何未对齐起点最多八格，放大保持原始精度', () => {
  expect(spectrumPoolLevel(1, 20)).toBe(0)
  for (const span of [2, 7, 8, 15, 16, 1025, 8192]) {
    const level = spectrumPoolLevel(span, 20), divisor = 2 ** level
    for (let start = 0; start < divisor; start++) {
      expect(Math.floor((start + span - 1) / divisor) - Math.floor(start / divisor) + 1).toBeLessThanOrEqual(8)
    }
  }
})

it('时间缩小不吞并相邻低频，奇数尾列的能量按真实样本数加权', () => {
  const values = new Uint8Array(9 * 3)
  for (let t = 0; t < 9; t++) values[t * 3 + 1] = t === 8 ? 240 : 0
  const texture = buildSpectrumTexture({ sampleRate: 4, fftSize: 4, hop: 1, startFrame: 0, frameCount: 9, binCount: 3, channelCount: 1, values }, 16, 4)
  const last = texture.levels.at(-1)!
  expect(texture.levels.every(level => level.bins === 3)).toBe(true)
  expect(texture.values[(last.offset + 1) * 2]).toBe(240)
  expect(texture.values[(last.offset + 1) * 2 + 1]).toBeCloseTo(Math.round(spectrumDb((spectrumPower(240) + 8 * spectrumPower(0)) / 9)), 0)
  expect(sampleSpectrum(texture, 0, 0, 9, 0, 0, 0)).toBe(0)
  const result = sampleSpectrum(texture, 0, 0, 9, 1, 1, 1)
  const expected = 240 * SPECTRUM_PEAK_WEIGHT + spectrumDb((spectrumPower(240) + 8 * spectrumPower(0)) / 9) * (1 - SPECTRUM_PEAK_WEIGHT)
  expect(result).toBeCloseTo(expected, 0)
  expect(result).toBeGreaterThan(220)
  expect(result).toBeLessThan(240)
})

it('两轴放大在 dB 上双线性插值，整数采样中心保持原值', () => {
  const texture = buildSpectrumTexture({ sampleRate: 2, fftSize: 2, hop: 1, startFrame: 0, frameCount: 2, binCount: 2, channelCount: 1, values: new Uint8Array([0, 100, 100, 200]) }, 8, 1)
  expect(sampleSpectrum(texture, 0, 0.9, 1.1, 0.4, 0.6, 0.5)).toBeCloseTo(100)
  expect(sampleSpectrum(texture, 0, 1.4, 1.6, 0.9, 1.1, 1)).toBeCloseTo(200)
  const ramp = Array.from({ length: 21 }, (_, i) => sampleSpectrum(texture, 0, 0.45 + i / 20, 0.55 + i / 20, 0, 0, 0))
  expect(new Set(ramp.map(Math.round)).size).toBe(21)
})
