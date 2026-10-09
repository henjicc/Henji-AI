/** 保留既有取样预算：大 sigma 先降采样，最多七级，一维核半径最多 32。 */
export const MAX_GAUSSIAN_DIRECT_SIGMA = 3
export const MAX_GAUSSIAN_LEVELS = 7

interface GaussianSize { width: number; height: number }
export interface GaussianPlanningPolicy {
  directSigma: number
  support: number
  /** 旧调用方保持七级；效果描述按画面实际尺寸结束，不设半径上限。 */
  maxLevels: number
  maxRadius: number
  /** final 的抗混叠预滤波；旧 R06 调用不增加工序。 */
  prefilterSigma?: number
  discreteReconstruction?: boolean
  /** final 保留亚像素核；R06 交互调用仍按 0.3px 起算。 */
  minimumSigma?: number
}
export interface GaussianPlanInput extends GaussianSize {
  /** 原始输入像素的标准差；不模糊的轴传 0。 */
  sigmaX: number
  sigmaY: number
  repeatEdges: boolean
  targetSize?: GaussianSize
  policy?: GaussianPlanningPolicy
}
interface GaussianPassSize extends GaussianSize { sourceWidth: number; sourceHeight: number }
export type GaussianPass =
  | (GaussianPassSize & { kind: 'downsample' | 'upsample' | 'copy' })
  | (GaussianPassSize & { kind: 'blur'; axis: 'x' | 'y'; sigma: number; radius: number; repeatEdges: boolean })
export interface GaussianPlan { downsampleLevels: number; passes: GaussianPass[] }

/**
 * 后端无关的可分离高斯计划。降采样/双线性回放大的方差从剩余 sigma 中扣除；
 * 单轴模糊只缩小对应轴。调用方负责纹理分配、滤波执行与参数精度转换。
 * 尺寸与 sigma 的校验沿用各领域入口，本函数不夹值或增加产品约束。
 */
export function planGaussian(input: GaussianPlanInput): GaussianPlan {
  const policy = input.policy ?? { directSigma: MAX_GAUSSIAN_DIRECT_SIGMA, support: 3, maxLevels: MAX_GAUSSIAN_LEVELS, maxRadius: 32 }
  const { sigmaX, sigmaY, repeatEdges } = input
  const target = input.targetSize ?? input
  let { width, height } = input
  let factorX = 1; let factorY = 1; let varianceX = 0; let varianceY = 0
  let downsampleLevels = 0
  const passes: GaussianPass[] = []
  for (let level = 0; level < policy.maxLevels; level++) {
    const halveX = sigmaX / factorX > policy.directSigma && width >= 16
    const halveY = sigmaY / factorY > policy.directSigma && height >= 16
    if (!halveX && !halveY) break
    const sourceWidth = width; const sourceHeight = height
    if (policy.prefilterSigma) for (const axis of ['x', 'y'] as const) {
      if (axis === 'x' ? halveX : halveY) passes.push({ kind: 'blur', sourceWidth, sourceHeight, width, height, axis, sigma: policy.prefilterSigma, radius: Math.ceil(policy.prefilterSigma * policy.support), repeatEdges })
    }
    const variance = 1 / 4 + (policy.prefilterSigma ?? 0) ** 2
    if (halveX) { varianceX += factorX ** 2 * variance; factorX *= 2; width = Math.ceil(width / 2) }
    if (halveY) { varianceY += factorY ** 2 * variance; factorY *= 2; height = Math.ceil(height / 2) }
    passes.push({ kind: 'downsample', sourceWidth, sourceHeight, width, height })
    downsampleLevels++
  }
  const residual = (sigma: number, factor: number, variance: number): number => Math.sqrt(Math.max(0, sigma ** 2 - variance - (factor > 1 ? factor ** 2 / 6 + (policy.discreteReconstruction ? 1 / 12 : 0) : 0))) / factor
  const steps: Array<{ axis: 'x' | 'y'; sigma: number }> = [{ axis: 'x' as const, sigma: residual(sigmaX, factorX, varianceX) }, { axis: 'y' as const, sigma: residual(sigmaY, factorY, varianceY) }].filter(step => step.sigma > 0 && step.sigma >= (policy.minimumSigma ?? 0.3))
  const upsample = factorX > 1 || factorY > 1
  if (!steps.length && !upsample) {
    passes.push({ kind: 'copy', sourceWidth: width, sourceHeight: height, width: target.width, height: target.height })
  }
  steps.forEach((step, index) => {
    const last = index === steps.length - 1 && !upsample
    passes.push({ kind: 'blur', sourceWidth: width, sourceHeight: height,
      width: last ? target.width : width, height: last ? target.height : height,
      axis: step.axis, sigma: step.sigma, radius: Math.min(policy.maxRadius, Math.ceil(step.sigma * policy.support)), repeatEdges })
  })
  if (upsample) passes.push({ kind: 'upsample', sourceWidth: width, sourceHeight: height, width: target.width, height: target.height })
  return { downsampleLevels, passes }
}
