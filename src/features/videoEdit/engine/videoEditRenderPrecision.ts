import { planVideoEditBuiltinEffect } from './videoEditBuiltinEffectPasses'
import { resolveVideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinEffectInstance } from '@/core/videoEdit/compositing'
import { colorGradeCurvePoints } from '@/core/imaging/adjustments/curves'
import { COLOR_GRADE_CURVE_CHANNELS, COLOR_GRADE_HUE_CURVES } from '@/core/imaging/adjustments/colorGrade'

/** 只看当前已求值内容；源画布与运动曝光不声明额外精度。 */
type PrecisionContext = Omit<Parameters<typeof planVideoEditBuiltinEffect>[1], 'frame' | 'referenceSize' | 'renderScale'> & Required<Pick<Parameters<typeof planVideoEditBuiltinEffect>[1], 'referenceSize' | 'renderScale'>>
export function videoEditEffectNeedsFloat(effect: VideoEditBuiltinEffectInstance & { amount?: number }, context: PrecisionContext): boolean {
  if (effect.amount !== undefined && effect.amount <= 0) return false
  if (!['glow', 'gaussian_blur', 'directional_blur', 'zoom_blur', 'lens_blur', 'vignette', 'color_grade'].includes(effect.id)) return false
  const reference = context.referenceSize
  const height = reference.height
  const p = resolveVideoEditBuiltinParams(effect)
  const n = (key: string): number => Number(p[key]) || 0
  switch (effect.id) {
    case 'glow': return p.view !== 'source' && n('strength') > 0
    case 'gaussian_blur': return planVideoEditBuiltinEffect(effect, context.layer
      ? { width: reference.width, height, frame: 0, referenceSize: reference, renderScale: 1, quality: context.layer.quality }
      : { ...context, frame: 0 }).passes.some(pass => pass.entry !== 'copy')
    case 'directional_blur': return n('length') / 100 * .1 * height >= 1
    case 'zoom_blur': return n('strength') / 100 * .2 * height >= 1
    case 'lens_blur': return n('radius_fraction_height') * height > 0
    case 'vignette': return n('amount') !== 0
    case 'color_grade': {
      if (n('vignette_amount') || p.input_lut && n('input_lut_strength') || p.look_lut && n('look_lut_strength')) return true
      if (['tone_highlights', 'tone_lights', 'tone_darks', 'tone_shadows'].some(key => n(key) !== 0)) return true
      return [...COLOR_GRADE_CURVE_CHANNELS, ...COLOR_GRADE_HUE_CURVES].some(channel => {
        const hue = (COLOR_GRADE_HUE_CURVES as readonly string[]).includes(channel)
        if (hue && !p[`curve_${channel}_points`]) return false
        return colorGradeCurvePoints(p, channel).some(point => point.y !== (hue ? 50 : point.x))
      })
    }
    default: return false
  }
}
