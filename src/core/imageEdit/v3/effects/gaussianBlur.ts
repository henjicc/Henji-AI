import { createFloat32PremultipliedRgbaTile, mixProcessedWithMask, assertFloat32PremultipliedRgbaTile, type CpuReferenceKernelContract, type Float32PremultipliedRgbaTile, type Float32TileProcessOptions } from './contracts'
import { convertFloat32TileColorDomainV3 } from '../execution/tileColor'
import { GAUSSIAN_EFFECT, gaussianParameterSchema, type GaussianParameters, type ResolvedGaussianPlan } from '../../../imaging/effects/gaussian'
import { executeGaussianCpu } from '../../../imaging/effects/cpu/gaussian'
import type { EffectEvaluationContext, EffectQuality } from '../../../imaging/effects/descriptor'

/** 图片 dispatch 的像素 ABI；作品参数改为意图单位的接入由 R04 负责。 */
export interface GaussianBlurV2Parameters {
  readonly radius: number
  readonly mip: number
  readonly quality?: EffectQuality
  readonly axis?: GaussianParameters['axis']
  readonly edge_mode?: GaussianParameters['edge_mode']
}
export interface GaussianBlurV2Geometry {
  readonly radiusInDocumentPixels: number
  readonly radiusAtMip: number
  readonly haloInDocumentPixels: number
  readonly haloAtMip: number
  readonly pyramidLevel: number
  readonly radiusAtPyramidLevel: number
}
export const GAUSSIAN_BLUR_V2_CONTRACT: CpuReferenceKernelContract = {
  id: 'effect.gaussian-blur', version: 2, inputColorDomain: 'linear-light', outputColorDomain: 'linear-light', alpha: 'premultiplied', precision: 'float32', maskMix: 'source-to-processed',
}
/** 仅保留旧 dispatch 的输入输出包装；滤波语义统一为线性光，没有半径封顶。 */
export const LEGACY_GAUSSIAN_BLUR_V1_CONTRACT: CpuReferenceKernelContract = {
  id: 'effect.blur-v1', version: 1, inputColorDomain: 'perceptual-working', outputColorDomain: 'perceptual-working', alpha: 'premultiplied', precision: 'float32', maskMix: 'source-to-processed',
}

export function resolveImageGaussianPlan(parameters: GaussianParameters, context: EffectEvaluationContext): ResolvedGaussianPlan {
  return GAUSSIAN_EFFECT.resolve(parameters, context)
}

/** 现有 CPU/GPU pixel ABI 统一换算；H 仅抵消内部像素单位，不是作品参数参考轴。 */
export function resolveGaussianPixelPlan(parameters: GaussianBlurV2Parameters, width: number, height: number): ResolvedGaussianPlan {
  validateGaussianParameters(parameters)
  return resolveImageGaussianPlan(gaussianParameterSchema.parse({ sigma_fraction_height: parameters.radius / height, axis: parameters.axis, edge_mode: parameters.edge_mode }), {
    referenceSize: { width, height }, outputSize: { width: Math.max(1, Math.ceil(width / (2 ** parameters.mip))), height: Math.max(1, Math.ceil(height / (2 ** parameters.mip))) }, quality: parameters.quality ?? 'final',
  })
}

export function resolveGaussianBlurV2Geometry(parameters: GaussianBlurV2Parameters): GaussianBlurV2Geometry {
  validateGaussianParameters(parameters)
  const radiusAtMip = parameters.radius / (2 ** parameters.mip)
  // support 不依赖 tile 大小。虚拟网格只计算 support，不参与实际执行。
  const side = Math.max(16, Math.ceil(radiusAtMip * 16))
  const plan = resolveGaussianPixelPlan({ ...parameters, radius: radiusAtMip, mip: 0 }, side, side)
  const blur = plan.passes.filter(pass => pass.operation.kind === 'blur').at(-1)?.operation
  return { radiusInDocumentPixels: parameters.radius, radiusAtMip,
    haloAtMip: Math.max(...plan.halo), haloInDocumentPixels: Math.ceil(Math.max(...plan.halo) * (2 ** parameters.mip)),
    pyramidLevel: plan.downsampleLevels, radiusAtPyramidLevel: blur?.kind === 'blur' ? blur.sigma : 0 }
}

export function applyGaussianBlurV2(tile: Float32PremultipliedRgbaTile, parameters: GaussianBlurV2Parameters, options: Float32TileProcessOptions = {}): Float32PremultipliedRgbaTile {
  assertFloat32PremultipliedRgbaTile(tile, 'linear-light')
  validateGaussianParameters(parameters)
  const sigma = parameters.radius / (2 ** parameters.mip)
  const plan = resolveGaussianPixelPlan({ ...parameters, radius: sigma, mip: 0 }, tile.width, tile.height)
  const data = executeGaussianCpu(plan, { x: 0, y: 0, width: tile.width, height: tile.height, data: tile.data }).data
  return mixProcessedWithMask(tile, createFloat32PremultipliedRgbaTile(tile.width, tile.height, 'linear-light', data, tile.workingSpace, tile.transferFunction, tile.referenceWhiteNits), options.mask)
}

export function applyLegacyGaussianBlurV1(tile: Float32PremultipliedRgbaTile, radiusPixels: number, options: Float32TileProcessOptions = {}): Float32PremultipliedRgbaTile {
  assertFloat32PremultipliedRgbaTile(tile)
  const linear = convertFloat32TileColorDomainV3(tile, 'linear-light')
  const processed = applyGaussianBlurV2(linear, { radius: radiusPixels, mip: 0 })
  return mixProcessedWithMask(tile, convertFloat32TileColorDomainV3(processed, tile.colorDomain), options.mask)
}

function validateGaussianParameters(parameters: GaussianBlurV2Parameters): void {
  if (!Number.isFinite(parameters.radius) || parameters.radius < 0) throw new Error('Gaussian 半径必须是非负有限数')
  if (!Number.isFinite(parameters.mip) || parameters.mip < 0 || parameters.mip > 30) throw new Error('Gaussian mip 必须是 0～30 的有限数（坐标缩放精度约束）')
}
