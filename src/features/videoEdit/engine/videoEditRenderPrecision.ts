import { planVideoEditBuiltinEffect } from './videoEditBuiltinEffectPasses'
import { resolveVideoEditBuiltinParams, videoEditBuiltinEffect } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinEffectInstance } from '@/core/videoEdit/compositing'
import type { VideoEditBuiltinPlan } from './effectPlan'

/** 只看当前已求值内容；源画布与运动曝光不声明额外精度。 */
type PrecisionContext = Omit<Parameters<typeof planVideoEditBuiltinEffect>[1], 'frame' | 'referenceSize' | 'renderScale'> & Required<Pick<Parameters<typeof planVideoEditBuiltinEffect>[1], 'referenceSize' | 'renderScale'>>
export function videoEditEffectNeedsFloat(effect: VideoEditBuiltinEffectInstance & { amount?: number }, context: PrecisionContext): boolean {
  if (effect.amount !== undefined && effect.amount <= 0) return false
  const precision = videoEditBuiltinEffect(effect.id)?.precision
  if (!precision) return false
  const reference = context.referenceSize
  let plan: VideoEditBuiltinPlan | undefined
  return precision(resolveVideoEditBuiltinParams(effect), {
    // 纯参数判定不创建规划或调色查找表；需要工序时才按完整参考尺寸规划一次。
    get passes() {
      plan ??= planVideoEditBuiltinEffect(effect, context.layer
        ? { width: reference.width, height: reference.height, frame: 0, referenceSize: reference, renderScale: 1, quality: context.layer.quality, layer: { ...context.layer, rasterScale: 1 } }
        : { ...context, frame: 0 })
      return plan.passes
    },
  })
}
