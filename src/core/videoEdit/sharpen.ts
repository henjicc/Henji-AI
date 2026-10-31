/**
 * 锐化：反锐化掩模，原画加上“原画减去模糊画面”的差。半径决定加强多粗的细节，阈值让平坦处不出噪点。
 * 实现在剪辑内置效果工序（`features/videoEdit/engine/videoEditBuiltinEffectPasses.ts`），着色器与图片编辑调色的锐化共用 unsharp。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { gaussianSupport, type LayerEffectReference } from './layerEffectGeometry'

/** 半径 → 模糊画面的高斯标准差（画面高度的比例）：30 为 0.15%，每加 20 翻一倍。 */
export function sharpenSigma(radius: number): number { return 0.0015 * 2 ** ((radius - 30) / 20) }
/** 最细也要约半个像素以上，否则差值只剩取样误差。 */
export const SHARPEN_MIN_SIGMA_PX = 0.6

export function sharpenBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference): number {
  const h = ref.referenceSize.height * ref.rasterScale
  const sigma = Math.max(SHARPEN_MIN_SIGMA_PX, sharpenSigma(Number(params.radius ?? 30)) * h)
  return gaussianSupport(sigma, Math.ceil(ref.contentBounds.width * ref.rasterScale), Math.ceil(ref.contentBounds.height * ref.rasterScale), ref.quality) / h
}

const DESCRIPTION = '加强边缘和细节，让画面更清楚。适合拍得略软或缩小过的画面；调得太高边缘会出白边。'

export const SHARPEN_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', author: { factory: 'sharpen' }, bleed: sharpenBleed, id: 'sharpen', name: '锐化', group: 'blur', description: DESCRIPTION,
  aliases: ['锐度', '清晰度', 'sharpen', 'sharpness', 'unsharp mask'],
  params: [
    effectParam.amount('amount', 30, { name: '锐化量', text: '边缘加强多少。0 不锐化；30（默认）自然的清晰度；60 明显锐利；100 以上容易出白边和噪点，可以输入到 200。' }, 200),
    effectParam.amount('radius', 30, { group: '细节', name: '半径', text: '加强多粗的细节。30（默认）只加强细小纹理；0 连发丝和噪点一起加强；70 以上加强大块明暗，画面更有立体感。' }),
    effectParam.amount('threshold', 0, { group: '细节', name: '阈值', text: '明暗差多小的地方不锐化。0（默认）全部锐化；10–20 天空、皮肤这类平坦处不出噪点，只加强真正的边缘。' }),
  ],
}
