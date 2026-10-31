// 由 scripts/generate-author-effects.ts 生成，请修改效果登记后重新生成。
import type { BlurParams, SharpenParams, ColorGradeParams, BlackWhiteParams, InvertParams, GradientMapParams, PosterizeParams, GlowParams, LightSweepParams, DropShadowParams, StrokeParams, VignetteParams, ChromaticAberrationParams, FilmGrainParams, HalftoneParams, DitherPatternParams, PaperParams, ScratchesParams, MosaicParams, GlitchParams, DissolveRevealParams } from '@/core/videoEdit/authorEffects.generated'
export function blur(params: BlurParams = {}): { readonly id: 'blur'; readonly params: BlurParams } { return { id: 'blur', params } }
export function sharpen(params: SharpenParams = {}): { readonly id: 'sharpen'; readonly params: SharpenParams } { return { id: 'sharpen', params } }
export function colorGrade(params: ColorGradeParams = {}): { readonly id: 'color_grade'; readonly params: ColorGradeParams } { return { id: 'color_grade', params } }
export function blackWhite(params: BlackWhiteParams = {}): { readonly id: 'black_white'; readonly params: BlackWhiteParams } { return { id: 'black_white', params } }
export function invert(params: InvertParams = {}): { readonly id: 'invert'; readonly params: InvertParams } { return { id: 'invert', params } }
export function gradientMap(params: GradientMapParams = {}): { readonly id: 'gradient_map'; readonly params: GradientMapParams } { return { id: 'gradient_map', params } }
export function posterize(params: PosterizeParams = {}): { readonly id: 'posterize'; readonly params: PosterizeParams } { return { id: 'posterize', params } }
export function glow(params: GlowParams = {}): { readonly id: 'glow'; readonly params: GlowParams } { return { id: 'glow', params } }
export function lightSweep(params: LightSweepParams = {}): { readonly id: 'light_sweep'; readonly params: LightSweepParams } { return { id: 'light_sweep', params } }
export function shadow(params: DropShadowParams = {}): { readonly id: 'drop_shadow'; readonly params: DropShadowParams } { return { id: 'drop_shadow', params } }
export function stroke(params: StrokeParams = {}): { readonly id: 'stroke'; readonly params: StrokeParams } { return { id: 'stroke', params } }
export function vignette(params: VignetteParams = {}): { readonly id: 'vignette'; readonly params: VignetteParams } { return { id: 'vignette', params } }
export function chromaticAberration(params: ChromaticAberrationParams = {}): { readonly id: 'chromatic_aberration'; readonly params: ChromaticAberrationParams } { return { id: 'chromatic_aberration', params } }
export function grain(params: FilmGrainParams = {}): { readonly id: 'film_grain'; readonly params: FilmGrainParams } { return { id: 'film_grain', params } }
export function halftone(params: HalftoneParams = {}): { readonly id: 'halftone'; readonly params: HalftoneParams } { return { id: 'halftone', params } }
export function ditherPattern(params: DitherPatternParams = {}): { readonly id: 'dither_pattern'; readonly params: DitherPatternParams } { return { id: 'dither_pattern', params } }
export function paper(params: PaperParams = {}): { readonly id: 'paper'; readonly params: PaperParams } { return { id: 'paper', params } }
export function scratches(params: ScratchesParams = {}): { readonly id: 'scratches'; readonly params: ScratchesParams } { return { id: 'scratches', params } }
export function mosaic(params: MosaicParams = {}): { readonly id: 'mosaic'; readonly params: MosaicParams } { return { id: 'mosaic', params } }
export function glitch(params: GlitchParams = {}): { readonly id: 'glitch'; readonly params: GlitchParams } { return { id: 'glitch', params } }
export function dissolve(params: DissolveRevealParams = {}): { readonly id: 'dissolve_reveal'; readonly params: DissolveRevealParams } { return { id: 'dissolve_reveal', params } }
