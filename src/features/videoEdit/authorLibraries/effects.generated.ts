// 由 scripts/generate-author-effects.ts 生成，请修改效果登记后重新生成。
import type { BlurParams, SharpenParams, BlackWhiteParams, MosaicParams, ChromaticAberrationParams, GlowParams, DropShadowParams, StrokeParams, LightSweepParams, DissolveRevealParams, ColorGradeParams } from '@/core/videoEdit/authorEffects.generated'
export function blur(params: BlurParams = {}): { readonly id: 'blur'; readonly params: BlurParams } { return { id: 'blur', params } }
export function sharpen(params: SharpenParams = {}): { readonly id: 'sharpen'; readonly params: SharpenParams } { return { id: 'sharpen', params } }
export function blackWhite(params: BlackWhiteParams = {}): { readonly id: 'black_white'; readonly params: BlackWhiteParams } { return { id: 'black_white', params } }
export function mosaic(params: MosaicParams = {}): { readonly id: 'mosaic'; readonly params: MosaicParams } { return { id: 'mosaic', params } }
export function chromaticAberration(params: ChromaticAberrationParams = {}): { readonly id: 'chromatic_aberration'; readonly params: ChromaticAberrationParams } { return { id: 'chromatic_aberration', params } }
export function glow(params: GlowParams = {}): { readonly id: 'glow'; readonly params: GlowParams } { return { id: 'glow', params } }
export function shadow(params: DropShadowParams = {}): { readonly id: 'drop_shadow'; readonly params: DropShadowParams } { return { id: 'drop_shadow', params } }
export function stroke(params: StrokeParams = {}): { readonly id: 'stroke'; readonly params: StrokeParams } { return { id: 'stroke', params } }
export function lightSweep(params: LightSweepParams = {}): { readonly id: 'light_sweep'; readonly params: LightSweepParams } { return { id: 'light_sweep', params } }
export function dissolve(params: DissolveRevealParams = {}): { readonly id: 'dissolve_reveal'; readonly params: DissolveRevealParams } { return { id: 'dissolve_reveal', params } }
export function colorGrade(params: ColorGradeParams = {}): { readonly id: 'color_grade'; readonly params: ColorGradeParams } { return { id: 'color_grade', params } }
