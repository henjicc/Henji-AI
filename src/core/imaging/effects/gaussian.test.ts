import { describe, expect, it } from 'vitest'
import { GAUSSIAN_EFFECT, gaussianParameterSchema, resolveGaussianPlan } from './gaussian'
import { executeGaussianCpu, gaussianExecutionWindows, type GaussianPixelWindow, type GaussianRegion } from './cpu/gaussian'
import { resolveImageGaussianPlan } from '../../imageEdit/v3/effects/gaussianBlur'
import { resolveVideoGaussianPlan } from '../../../features/videoEdit/engine/videoEditBuiltinEffectPasses'
import { requireImagingEffect, DISTINCT_BLUR_MODELS } from './registry'

function input(width: number, height: number): GaussianPixelWindow {
  const data = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = ((x * 17 + y * 31) % 11) / 10
    data.set(alpha === 0 ? [0, 0, 0, 0] : [Math.sin(x / 7) * alpha, 1.5 * alpha, -0.25 * alpha, alpha], (y * width + x) * 4)
  }
  return { x: 0, y: 0, width, height, data }
}
function crop(source: GaussianPixelWindow, region: GaussianRegion): GaussianPixelWindow {
  const data = new Float32Array(region.width * region.height * 4)
  for (let y = 0; y < region.height; y++) data.set(source.data.subarray(((y + region.y) * source.width + region.x) * 4, ((y + region.y) * source.width + region.x + region.width) * 4), y * region.width * 4)
  return { ...region, data }
}

describe('中立效果描述与两宿主规划', () => {
  it('严格意图 schema、不设半径上限，独立视觉模型不混入标准高斯', () => {
    expect(requireImagingEffect('gaussian_blur')).toBe(GAUSSIAN_EFFECT)
    expect(gaussianParameterSchema.safeParse({ radius: 10 }).success).toBe(false)
    expect(gaussianParameterSchema.safeParse({ sigma_fraction_height: 10 }).success).toBe(true)
    expect(DISTINCT_BLUR_MODELS.map(effect => effect.id)).toEqual(['fast-blur', 'scatter-blur', 'shaders.Blur'])
  })
  it.each(['interactive', 'final'] as const)('%s 的图片与剪辑 ResolvedPlan 逐字段相同（奇数网格、各轴、边缘）', quality => {
    for (const axis of ['both', 'horizontal', 'vertical'] as const) for (const edge_mode of ['clamp', 'transparent'] as const) {
      const parameters = gaussianParameterSchema.parse({ sigma_fraction_height: 0.03, axis, edge_mode })
      const context = { referenceSize: { width: 1921, height: 1081 }, outputSize: { width: 961, height: 541 }, quality }
      expect(resolveVideoGaussianPlan(parameters, context)).toEqual(resolveImageGaussianPlan(parameters, context))
      expect(resolveImageGaussianPlan(parameters, context).referenceSize.height).toBe(1081)
    }
  })
})

describe('线性预乘高斯 CPU 符合性', () => {
  it('final 的亚像素标准差保留归一离散高斯核，不沿用交互起步阈值', () => {
    const width = 17; const height = 1; const center = 8; const data = new Float32Array(width * 4)
    data.set([1, 1, 1, 1], center * 4)
    for (const sigma of [0.25, 0.29, 0.5]) {
      const plan = resolveGaussianPlan(gaussianParameterSchema.parse({ sigma_fraction_height: sigma, axis: 'horizontal', edge_mode: 'transparent' }), { referenceSize: { width, height }, outputSize: { width, height }, quality: 'final' })
      const result = executeGaussianCpu(plan, { x: 0, y: 0, width, height, data })
      const radius = Math.ceil(sigma * 4)
      const weights = Array.from({ length: radius * 2 + 1 }, (_, at) => Math.exp(-((at - radius) ** 2) / (2 * sigma ** 2)))
      const total = weights.reduce((sum, value) => sum + value, 0)
      for (let x = 0; x < width; x++) expect(result.data[x * 4]).toBeCloseTo(Math.abs(x - center) <= radius ? weights[x - center + radius] / total : 0, 7)
    }
  })
  it('interactive 相对 final 的定向冲激误差不超过记录预算', () => {
    const width = 2049; const height = 1; const data = new Float32Array(width * 4)
    data.set([1, 1, 1, 1], 1024 * 4)
    for (const sigma of [1, 3.24, 16, 32.4, 64.8]) {
      const parameters = gaussianParameterSchema.parse({ sigma_fraction_height: sigma, axis: 'horizontal', edge_mode: 'transparent' })
      const results = (['interactive', 'final'] as const).map(quality => executeGaussianCpu(resolveGaussianPlan(parameters, { referenceSize: { width, height }, outputSize: { width, height }, quality }), { x: 0, y: 0, width, height, data }).data)
      let max = 0; let sum = 0
      for (let at = 0; at < data.length; at++) { const delta = results[0][at] - results[1][at]; max = Math.max(max, Math.abs(delta)); sum += delta ** 2 }
      expect(max).toBeLessThan(0.013)
      expect(Math.sqrt(sum / data.length)).toBeLessThan(0.0008)
    }
  })
  it.each(['interactive', 'final'] as const)('%s 冲激能量与二阶矩；单轴不扩散另一轴', quality => {
    for (const sigma of [1, 3.24, 16, 32.4]) {
      const width = 513; const height = 1; const center = 256
      const data = new Float32Array(width * 4); data.set([1, 0.25, 0, 0.5], center * 4)
      const parameters = gaussianParameterSchema.parse({ sigma_fraction_height: sigma, axis: 'horizontal', edge_mode: 'transparent' })
      const plan = resolveGaussianPlan(parameters, { referenceSize: { width, height }, outputSize: { width, height }, quality })
      const result = executeGaussianCpu(plan, { x: 0, y: 0, width, height, data })
      let energy = 0; let moment = 0; let mean = 0
      for (let x = 0; x < width; x++) { const value = result.data[x * 4]; energy += value; mean += (x - center) * value; moment += (x - center) ** 2 * value }
      expect(energy).toBeCloseTo(1, 6)
      const variance = moment / energy - (mean / energy) ** 2
      expect(Math.abs(variance / (sigma ** 2) - 1)).toBeLessThan(quality === 'final' ? 0.0012 : 0.08)
      expect(plan.passes.every(pass => pass.operation.kind !== 'blur' || pass.operation.axis === 'x')).toBe(true)
    }
  })
  it('透明边无无色像素泄漏，HDR负值与大于1值保留；clamp保持常量', () => {
    const source = input(17, 19)
    source.data.set([99, -88, 77, 0], 0)
    const parameters = gaussianParameterSchema.parse({ sigma_fraction_height: 0.1, edge_mode: 'transparent' })
    const plan = resolveGaussianPlan(parameters, { referenceSize: source, outputSize: source, quality: 'final' })
    const result = executeGaussianCpu(plan, source)
    source.data.set([0, 0, 0, 0], 0)
    expect(result.data).toEqual(executeGaussianCpu(plan, source).data)
    for (let at = 0; at < result.data.length; at += 4) {
      expect(result.data[at + 1]).toBeCloseTo(1.5 * result.data[at + 3], 6)
      expect(result.data[at + 2]).toBeCloseTo(-0.25 * result.data[at + 3], 6)
    }
  })
  it.each(['interactive', 'final'] as const)('%s 整幅与非对齐奇数 tile 拼接逐像素完全相同（含金字塔）', quality => {
    const source = input(137, 131)
    for (const axis of ['both', 'vertical', 'horizontal'] as const) for (const edge_mode of ['clamp', 'transparent'] as const) {
      const plan = resolveGaussianPlan(gaussianParameterSchema.parse({ sigma_fraction_height: 0.25, axis, edge_mode }), { referenceSize: source, outputSize: source, quality })
      const whole = executeGaussianCpu(plan, source)
      for (const region of [{ x: 0, y: 0, width: 61, height: 63 }, { x: 61, y: 63, width: 76, height: 68 }, { x: 30, y: 22, width: 79, height: 71 }]) {
        const halo = gaussianExecutionWindows(plan, region)[0]
        expect(executeGaussianCpu(plan, crop(source, halo), region).data).toEqual(crop(whole, region).data)
      }
    }
  })
  it('缺少真实 halo 明确拒绝；零标准差不修改合法预乘数据', () => {
    const source = input(31, 33)
    const plan = resolveGaussianPlan(gaussianParameterSchema.parse({ sigma_fraction_height: 0.1 }), { referenceSize: source, outputSize: source, quality: 'final' })
    expect(() => executeGaussianCpu(plan, crop(source, { x: 10, y: 10, width: 4, height: 4 }), { x: 10, y: 10, width: 4, height: 4 })).toThrow('halo')
    const zero = resolveGaussianPlan(gaussianParameterSchema.parse({ sigma_fraction_height: 0 }), { referenceSize: source, outputSize: source, quality: 'interactive' })
    expect(executeGaussianCpu(zero, source).data).toEqual(source.data)
  })
})
