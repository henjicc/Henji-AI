import { describe, expect, it } from 'vitest'
import { BLACK_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import { buildSpectrogramLut, spectrogramHzAt, spectrogramPositionOf, spectrogramTicks } from './spectrogram'

const lut = buildSpectrogramLut([BLACK_HEX, WHITE_HEX])
describe('频谱图频率轴与色表', () => {
  it('频率与纵向位置互逆，对数轴两端对得上', () => {
    for (const scale of ['log', 'linear'] as const) {
      for (const hz of [100, 1000, 8000]) expect(spectrogramHzAt(spectrogramPositionOf(hz, 20, 20000, scale), 20, 20000, scale)).toBeCloseTo(hz, 3)
    }
    expect(spectrogramHzAt(0, 20, 20000, 'log')).toBeCloseTo(20)
    expect(spectrogramHzAt(1, 20, 20000, 'log')).toBeCloseTo(20000)
    expect(spectrogramHzAt(1, 20, 24000, 'log')).toBe(24000)
  })

  it('色表两端与中点', () => {
    expect([...lut.slice(0, 4)]).toEqual([0, 0, 0, 255])
    expect([...lut.slice(255 * 4, 256 * 4)]).toEqual([255, 255, 255, 255])
    expect(lut[128 * 4]).toBeGreaterThan(120)
  })

  it('对数刻度取 1-2-5 序列，线性刻度等距', () => {
    expect(spectrogramTicks(20, 20000, 'log')).toEqual([20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000])
    expect(spectrogramTicks(0, 20000, 'linear', 4)).toEqual([0, 5000, 10000, 15000, 20000])
  })
})
