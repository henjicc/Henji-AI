import { resolveGaussianPlan } from '../imaging/effects/gaussian'
import { colorGradeSpatialSupport } from '../imaging/adjustments/plan'
import type { ImagingParams } from '../imaging/parameterDefinition'
import type { EffectQuality, EffectSize } from '../imaging/effects/descriptor'
import { glowEnergySupport } from './glowEnergy'

export interface LayerEffectReference {
  referenceSize: EffectSize
  contentBounds: { x: number; y: number; width: number; height: number }
  rasterScale: number
  rasterOrigin: readonly [number, number]
  quality: EffectQuality
}

export function glowLevels(radius: number, width: number, height: number, resolution: number, referenceHeight = height): { first: EffectSize; count: number; reach: number } {
  const first = { width: Math.max(1, Math.ceil(width * resolution)), height: Math.max(1, Math.ceil(height * resolution)) }
  const pixels = referenceHeight * 0.004 * (0.6 / 0.004) ** (radius / 100)
  const reach = Math.log2(pixels * resolution / 1.5) + 1
  const limit = Math.max(1, Math.floor(Math.log2(Math.min(first.width, first.height) / 2)) + 1)
  return { first, count: Math.min(limit, Math.max(1, Math.ceil(reach - 1e-9))), reach }
}

export function gaussianSupport(sigma: number, width: number, height: number, quality: EffectQuality = 'interactive'): number {
  const size = { width: Math.max(1, width), height: Math.max(1, height) }
  const plan = resolveGaussianPlan({ sigma_fraction_height: sigma / size.height, axis: 'both', edge_mode: 'transparent' }, { referenceSize: size, outputSize: size, quality })
  return Math.max(...plan.halo)
}

/** 保守支撑以逻辑高度比例返回；邻域串联时由调用者累加。 */
export function layerEffectBleed(id: string, params: ImagingParams, ref: LayerEffectReference): number {
  const h = ref.referenceSize.height * ref.rasterScale
  const w = Math.ceil(ref.contentBounds.width * ref.rasterScale), bh = Math.ceil(ref.contentBounds.height * ref.rasterScale)
  const n = (key: string): number => Number(params[key] ?? 0)
  switch (id) {
    case 'gaussian_blur': return gaussianSupport(n('sigma_fraction_height') * h, w, bh, ref.quality) / h
    case 'directional_blur': return n('length') / 100 * .1 * (1 + 1 / 16)
    // 反向采样的最远边界为 distance * k / (1 - k)，而非 distance * k。
    case 'zoom_blur': {
      const k = n('strength') / 100 * .25
      const distance = Math.max(w * Math.max(n('center_x') / 100, 1 - n('center_x') / 100), bh * Math.max(n('center_y') / 100, 1 - n('center_y') / 100))
      return (distance * k / (1 - k) + (k > 0 ? 2 : 0)) / h
    }
    case 'lens_blur': return n('radius_fraction_height') * 1.5
    case 'chromatic_aberration': return n('amount') / 100 * .025 * 2
    case 'sharpen': return gaussianSupport(.0015 * h, w, bh, ref.quality) / h
    case 'mosaic': return Math.max(1, n('block_size') / 100 * .1 * h) / h
    case 'color_grade': return colorGradeSpatialSupport(params, h) / h
    case 'glow': {
      if (params.view === 'source' || n('strength') === 0) return 0
      return glowEnergySupport(params, w, bh, h, ref.quality) / h + n('aberration_amount') / 100 * .05
    }
    default: return 0
  }
}
