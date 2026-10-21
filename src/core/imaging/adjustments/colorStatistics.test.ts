import { describe, expect, it } from 'vitest'
import { computeColorStatistics } from './colorStatistics'
import { applyEvaluationCast, createEvaluationScenes } from './autoGradeEvaluation'
import { linearToSrgb } from './colorScience'

const fill = (width: number, height: number, rgb: (x: number, y: number) => number[]): Float32Array => {
  const out = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.set([...rgb(x, y), 1], (y * width + x) * 4)
  return out
}

describe('颜色读数', () => {
  it('18% 中灰读作 0 EV、6500 K、无溢出；半幅纯白读作约一半高光溢出', () => {
    const grey = linearToSrgb(.18)
    const flat = computeColorStatistics(fill(32, 32, () => [grey, grey, grey]), 32, 32, { scale: 1 })
    expect(flat.readout.exposure.middleGrayOffsetEv).toBeCloseTo(0, 1)
    expect(flat.readout.clipping).toEqual({ highlightsPercent: 0, shadowsPercent: 0 })
    expect(Math.abs(flat.readout.whiteBalance.kelvin - 6500)).toBeLessThan(30)
    expect(flat.readout.color.chromaMedian).toBeLessThan(.002)
    const half = computeColorStatistics(fill(32, 32, x => x < 16 ? [1, 1, 1] : [grey, grey, grey]), 32, 32, { scale: 1 })
    expect(half.readout.clipping.highlightsPercent).toBeCloseTo(50, 0)
  })
  it('暖光偏色的室内画面估出接近施加的色温，低调夜景标记为 low', () => {
    const [indoor, , , night] = createEvaluationScenes()
    const warm = computeColorStatistics(applyEvaluationCast(indoor, { kelvin: 3200, tint: 0, ev: 0 }), indoor.width, indoor.height, { scale: 1 })
    expect(Math.abs(warm.readout.whiteBalance.kelvin - 3200)).toBeLessThan(450)
    expect(warm.readout.whiteBalance.confidence).toBeGreaterThan(.3)
    const dark = computeColorStatistics(applyEvaluationCast(night, { kelvin: 6500, tint: 0, ev: 0 }), night.width, night.height, { scale: 1 })
    expect(dark.readout.exposure.key).toBe('low')
    expect(dark.readout.exposure.middleGrayOffsetEv).toBeLessThan(-2)
  })
  it('人像画面有肤色候选；示波器数组尺寸固定且归一化', () => {
    const portrait = createEvaluationScenes()[2]
    const stats = computeColorStatistics(applyEvaluationCast(portrait, { kelvin: 6500, tint: 0, ev: 0 }), portrait.width, portrait.height, { scale: 1, scopes: true })
    expect(stats.readout.skin.candidatePercent).toBeGreaterThan(10)
    expect(stats.readout.skin.hueOffsetDegrees).not.toBeNull()
    expect(stats.scopes!.histogram.luma).toHaveLength(64)
    expect(stats.scopes!.waveform.density).toHaveLength(64 * 48)
    expect(stats.scopes!.vectorscope.density).toHaveLength(48 * 48)
    expect(Math.max(...stats.scopes!.histogram.luma)).toBe(1)
    expect(stats.readout.color.palette.length).toBeGreaterThan(0)
  })
  it('透明画面给出可恢复的失败', () => {
    expect(() => computeColorStatistics(new Float32Array(16 * 4), 4, 4, { scale: 1 })).toThrow('透明')
  })
})
