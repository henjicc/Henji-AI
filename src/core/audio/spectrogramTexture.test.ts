import { expect, it } from 'vitest'
import { buildSpectrumTexture, spectrumPoolLevel, spectrumTexelAddress } from './spectrogramTexture'

it('超长帧、奇数频点与声道跨页后仍逐样本对应，最大值层级保留单点峰值', () => {
  const data = { sampleRate: 48000, fftSize: 8, hop: 2, startFrame: 0, frameCount: 19, binCount: 5, channelCount: 2, values: new Uint8Array(190) }
  data.values[18 * 5 + 4] = 255; data.values[95 + 7 * 5 + 1] = 127
  const packed = buildSpectrumTexture(data, 8, 16)
  expect(packed.layers).toBeGreaterThan(1)
  for (let channel = 0; channel < 2; channel++) {
    for (let frame = 0; frame < 19; frame++) for (let bin = 0; bin < 5; bin++) {
      const index = channel * packed.channelStride + frame * 5 + bin
      const [x, y, page] = spectrumTexelAddress(index, packed.width, packed.height)
      expect(packed.values[page * packed.width * packed.height + y * packed.width + x]).toBe(data.values[channel * 95 + frame * 5 + bin])
    }
    const peakFrame = channel ? 7 : 18, peakBin = channel ? 1 : 4
    packed.levels.forEach((level, lod) => expect(packed.values[channel * packed.channelStride + level.offset + Math.floor(peakFrame / 2 ** lod) * level.bins + Math.floor(peakBin / 2 ** lod)]).toBe(channel ? 127 : 255))
  }
  expect(() => buildSpectrumTexture(data, 2, 1)).toThrow('上限')
})

it('池化范围在任何未对齐起点最多八格，放大保持原始精度', () => {
  expect(spectrumPoolLevel(1, 1, 20)).toBe(0)
  for (const span of [2, 7, 8, 15, 16, 1025, 8192]) {
    const level = spectrumPoolLevel(span, 3, 20), divisor = 2 ** level
    for (let start = 0; start < divisor; start++) {
      expect(Math.floor((start + span - 1) / divisor) - Math.floor(start / divisor) + 1).toBeLessThanOrEqual(8)
    }
  }
})
