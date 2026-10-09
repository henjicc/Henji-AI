import { z } from 'zod'
import { planGaussian, type GaussianPass } from '../adjustments/gaussianPlan'
import type { ImagingParam } from '../parameterDefinition'
import type { EffectDescriptor, EffectEvaluationContext, EffectQuality, EffectSize } from './descriptor'

export const GAUSSIAN_EFFECT_ID = 'gaussian_blur'
const SIGMA_DESCRIPTION = '高斯标准差占完整文档或序列画面高度的比例。0 无模糊；0.003 轻微柔化；0.009 背景虚化；0.03 强烈虚化。与视口、瓦片及预览缩放无关。'
export const GAUSSIAN_PARAMETERS: readonly ImagingParam[] = [
  { key: 'sigma_fraction_height', name: '模糊尺度', type: 'number', unit: 'fraction_height', min: 0, max: Number.MAX_VALUE, step: 0.001, default: 0.009, animatable: true, tooltip: '标准差占画面高度的比例', description: SIGMA_DESCRIPTION },
  { key: 'axis', name: '模糊方向', type: 'enum', default: 'both', animatable: true, options: [{ value: 'both', label: '水平和垂直' }, { value: 'horizontal', label: '水平' }, { value: 'vertical', label: '垂直' }], tooltip: '选择模糊方向', description: 'both 同时模糊两轴；horizontal 只水平；vertical 只垂直。' },
  { key: 'edge_mode', name: '边缘处理', type: 'enum', default: 'clamp', animatable: true, options: [{ value: 'clamp', label: '延伸边缘' }, { value: 'transparent', label: '透明边缘' }], tooltip: '决定画面外的取样方式', description: 'clamp 使用最近的画面边缘像素；transparent 把画面外视为透明。瓦片接缝始终读取真实相邻像素。' },
]
export const gaussianParameterSchema = z.object({
  sigma_fraction_height: z.number().nonnegative().default(0.009).describe(SIGMA_DESCRIPTION),
  axis: z.enum(['both', 'horizontal', 'vertical']).default('both').describe(GAUSSIAN_PARAMETERS[1].description),
  edge_mode: z.enum(['clamp', 'transparent']).default('clamp').describe(GAUSSIAN_PARAMETERS[2].description),
}).strict()
export type GaussianParameters = z.infer<typeof gaussianParameterSchema>
export interface ResolvedGaussianPass {
  readonly operation: GaussianPass
  /** 对齐全局像素中心的二进制网格；奇数边不改变网格间距。 */
  readonly sampleScale: readonly [number, number]
}
export interface ResolvedGaussianPlan {
  readonly effectId: typeof GAUSSIAN_EFFECT_ID
  readonly quality: EffectQuality
  readonly parameters: GaussianParameters
  readonly referenceSize: EffectSize
  readonly outputSize: EffectSize
  readonly sigma: readonly [number, number]
  readonly passes: readonly ResolvedGaussianPass[]
  readonly downsampleLevels: number
  readonly alignment: readonly [number, number]
  readonly halo: readonly [number, number]
  readonly haloInDocumentPixels: readonly [number, number]
  /** 不含输入/输出，按全部逻辑中间纹理分配计；实际池可复用。 */
  readonly scratchPixels: number
  readonly intermediateFormat: 'rgba16float' | 'rgba32float'
  readonly scratchBytes: number
}
export const GAUSSIAN_QUALITY = {
  interactive: { directSigma: 3, support: 3, maxLevels: Infinity, maxRadius: Infinity },
  final: { directSigma: 16, support: 4, maxLevels: Infinity, maxRadius: Infinity, prefilterSigma: 1.25, discreteReconstruction: true, minimumSigma: 0 },
} as const

export function resolveGaussianPlan(parameters: GaussianParameters, context: EffectEvaluationContext): ResolvedGaussianPlan {
  const parsed = gaussianParameterSchema.parse(parameters)
  for (const size of [context.referenceSize, context.outputSize]) {
    if (![size.width, size.height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('高斯模糊需要有效的完整画面尺寸')
  }
  if (!(context.quality in GAUSSIAN_QUALITY)) throw new Error('高斯模糊质量必须是 interactive 或 final')
  const sigmaDocument = parsed.sigma_fraction_height * context.referenceSize.height
  const sigmaX = parsed.axis === 'vertical' ? 0 : sigmaDocument * context.outputSize.width / context.referenceSize.width
  const sigmaY = parsed.axis === 'horizontal' ? 0 : sigmaDocument * context.outputSize.height / context.referenceSize.height
  if (![sigmaX, sigmaY].every(Number.isFinite)) throw new Error('sigma_fraction_height 超出有限像素数值范围')
  const planned = planGaussian({ ...context.outputSize, sigmaX, sigmaY, repeatEdges: parsed.edge_mode === 'clamp', policy: GAUSSIAN_QUALITY[context.quality] })
  if (planned.passes.some(pass => pass.kind === 'blur' && (!Number.isFinite(pass.sigma) || !Number.isSafeInteger(pass.radius)))) throw new Error('高斯核超出有限浮点或整数索引可表达范围')
  let factorX = 1; let factorY = 1; let haloX = 0; let haloY = 0
  const passes = planned.passes.map((operation): ResolvedGaussianPass => {
    let sampleScale: readonly [number, number] = [1, 1]
    if (operation.kind === 'downsample') {
      sampleScale = [operation.width < operation.sourceWidth ? 2 : 1, operation.height < operation.sourceHeight ? 2 : 1]
      // 二进制中心取样各轴 support 半像素；用一像素保守取整。
      haloX += sampleScale[0] === 2 ? factorX : 0
      haloY += sampleScale[1] === 2 ? factorY : 0
      factorX *= sampleScale[0]; factorY *= sampleScale[1]
    } else if (operation.kind === 'blur') {
      if (operation.axis === 'x') haloX += operation.radius * factorX
      else haloY += operation.radius * factorY
    } else if (operation.kind === 'upsample') {
      sampleScale = [1 / factorX, 1 / factorY]
      haloX += factorX > 1 ? factorX : 0; haloY += factorY > 1 ? factorY : 0
    }
    return { operation, sampleScale }
  })
  const halo: readonly [number, number] = [haloX, haloY]
  const scratchPixels = passes.slice(0, -1).reduce((sum, pass) => sum + pass.operation.width * pass.operation.height, 0)
  return {
    effectId: GAUSSIAN_EFFECT_ID, quality: context.quality, parameters: parsed,
    referenceSize: { ...context.referenceSize }, outputSize: { ...context.outputSize }, sigma: [sigmaX, sigmaY],
    passes, downsampleLevels: planned.downsampleLevels, alignment: [factorX, factorY], halo,
    haloInDocumentPixels: [Math.ceil(haloX * context.referenceSize.width / context.outputSize.width), Math.ceil(haloY * context.referenceSize.height / context.outputSize.height)],
    scratchPixels, intermediateFormat: context.quality === 'final' ? 'rgba32float' : 'rgba16float', scratchBytes: scratchPixels * (context.quality === 'final' ? 16 : 8),
  }
}

export const GAUSSIAN_EFFECT: EffectDescriptor<GaussianParameters, ResolvedGaussianPlan> = {
  id: GAUSSIAN_EFFECT_ID, name: '高斯模糊', aliases: ['Gaussian', '背景虚化', '柔化'], description: '在线性光预乘画面上均匀柔化，尺度按完整画面高度计算。',
  parameterSchema: gaussianParameterSchema, parameters: GAUSSIAN_PARAMETERS, inputs: 1,
  colorDomain: 'linear-light', workingSpaces: ['srgb', 'display-p3', 'rec2020'], alpha: 'premultiplied', boundary: ['clamp', 'transparent'], temporal: 'none', hosts: ['image', 'video'],
  backends: [{ kind: 'cpu-reference', module: 'effects/cpu/gaussian' }, { kind: 'wgsl', module: 'effects/wgsl/gaussian' }],
  fixtures: ['impulse', 'transparent-edge', 'single-axis', 'odd-size', 'halo-tile'], resolve: resolveGaussianPlan,
}
