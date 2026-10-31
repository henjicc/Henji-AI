// 由 scripts/generate-author-effects.ts 生成，请修改效果登记后重新生成。
import type { SharpenParams, BlackWhiteParams, MosaicParams, ChromaticAberrationParams, GlowParams, ColorGradeParams, BlurParams, BuiltinLayerEffectDescriptor } from '@/core/videoEdit/authorEffects.generated'
export function sharpen(params: SharpenParams = {}): { readonly id: 'sharpen'; readonly params: SharpenParams } { return { id: 'sharpen', params } }
export function blackWhite(params: BlackWhiteParams = {}): { readonly id: 'black_white'; readonly params: BlackWhiteParams } { return { id: 'black_white', params } }
export function mosaic(params: MosaicParams = {}): { readonly id: 'mosaic'; readonly params: MosaicParams } { return { id: 'mosaic', params } }
export function chromaticAberration(params: ChromaticAberrationParams = {}): { readonly id: 'chromatic_aberration'; readonly params: ChromaticAberrationParams } { return { id: 'chromatic_aberration', params } }
export function glow(params: GlowParams = {}): { readonly id: 'glow'; readonly params: GlowParams } { return { id: 'glow', params } }
export function colorGrade(params: ColorGradeParams = {}): { readonly id: 'color_grade'; readonly params: ColorGradeParams } { return { id: 'color_grade', params } }
export function blur(params: BlurParams = {}): BuiltinLayerEffectDescriptor {
  const { mode = 'gaussian', ...values } = params
  const id = ({"gaussian":"gaussian_blur","directional":"directional_blur","radial":"zoom_blur","lens":"lens_blur"} as const)[mode]
  if (!id) throw new Error('未知 blur.mode')
  return { id, params: values } as BuiltinLayerEffectDescriptor
}
