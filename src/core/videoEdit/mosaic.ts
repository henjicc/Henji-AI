/**
 * 马赛克：按块大小降采样取平均，再最近邻放大；块以画面（图层上为内容）中心对齐。
 */
import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { layerEffectBleed } from './layerEffectGeometry'

const DESCRIPTION = '把画面切成方块、每块取平均颜色，用来打码或做像素风。配合人脸、文字等作用区域可以只打码一部分。'

export const MOSAIC_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', author: { factory: 'mosaic' }, bleed: (p, r) => layerEffectBleed('mosaic', p, r), id: 'mosaic', name: '马赛克', group: 'stylize', description: DESCRIPTION,
  aliases: ['像素化', '打码', 'pixelate', 'mosaic'],
  params: [effectParam.amount('block_size', 30, { name: '块大小', text: '方块有多大。0 不打码；10 细小方块，约为画面高度的 1%；30（默认）常规打码；100 很大的色块，约 10%，可以输入到 200。' }, 200)],
}
