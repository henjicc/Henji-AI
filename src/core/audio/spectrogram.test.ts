import { describe, expect, it } from 'vitest'
import { BLACK_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import { buildSpectrogramLut, rasterizeSpectrogram, spectrogramHzAt, spectrogramPositionOf, spectrogramTicks, type SpectrogramData } from './spectrogram'

const lut = buildSpectrogramLut([BLACK_HEX, WHITE_HEX])
function data(fill: (frame: number, bin: number) => number, frames = 8, bins = 9): SpectrogramData {
  const values = new Uint8Array(frames * bins)
  for (let frame = 0; frame < frames; frame++) for (let bin = 0; bin < bins; bin++) values[frame * bins + bin] = fill(frame, bin)
  return { sampleRate: 16, fftSize: 16, hop: 4, startFrame: 0, frameCount: frames, binCount: bins, channelCount: 1, values }
}

describe('频谱图映射与栅格化', () => {
  it('频率与纵向位置互逆，对数轴两端对得上', () => {
    for (const scale of ['log', 'linear'] as const) {
      for (const hz of [100, 1000, 8000]) expect(spectrogramHzAt(spectrogramPositionOf(hz, 20, 20000, scale), 20, 20000, scale)).toBeCloseTo(hz, 3)
    }
    expect(spectrogramHzAt(0, 20, 20000, 'log')).toBeCloseTo(20)
    expect(spectrogramHzAt(1, 20, 20000, 'log')).toBeCloseTo(20000)
  })

  it('色表两端与中点', () => {
    expect([...lut.slice(0, 4)]).toEqual([0, 0, 0, 255])
    expect([...lut.slice(255 * 4, 256 * 4)]).toEqual([255, 255, 255, 255])
    expect(lut[128 * 4]).toBeGreaterThan(120)
  })

  it('最高频点画在最上面，缩小时一列取覆盖帧里最响的一帧', () => {
    // 频点 8（奈奎斯特，8Hz）全亮，其余全暗；只有第 5 帧有一个短促的亮点在频点 2。
    const source = data((frame, bin) => bin === 8 ? 255 : frame === 5 && bin === 2 ? 255 : 0)
    const pixels = rasterizeSpectrogram(source, { channel: 0, startFrame: 0, endFrame: 32, width: 2, height: 4, minHz: 0, maxHz: 8, scale: 'linear' }, lut)
    expect(pixels[0]).toBe(255) // 第一行第一列：最高频
    const bottomRight = (3 * 2 + 1) * 4
    const bottomLeft = (3 * 2) * 4
    expect(pixels[(2 * 2 + 1) * 4]).toBe(255) // 第二列（帧 4..7）里的频点 2 亮点
    expect(pixels[(2 * 2) * 4]).toBe(0)
    expect(pixels[bottomLeft]).toBe(0); expect(pixels[bottomRight]).toBe(0)
  })

  it('可见区间在数据之外时画成最暗色', () => {
    const pixels = rasterizeSpectrogram(data(() => 255), { channel: 0, startFrame: 1000, endFrame: 2000, width: 3, height: 2, minHz: 0, maxHz: 8, scale: 'linear' }, lut)
    expect(Math.max(...pixels.filter((_, index) => index % 4 !== 3))).toBe(0)
  })

  it('对数刻度取 1-2-5 序列，线性刻度等距', () => {
    expect(spectrogramTicks(20, 20000, 'log')).toEqual([20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000])
    expect(spectrogramTicks(0, 20000, 'linear', 4)).toEqual([0, 5000, 10000, 15000, 20000])
  })
})
