/**
 * 溶解显影：按图案场（蓝噪声颗粒、随机点阵、半调网点）与进度比较，让内容一点点显现或消散；
 * 正在显现的边缘可以带亮边，亮边包含发光。实现在 `features/videoEdit/engine/dissolveReveal.ts`。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { includedLightGlowParams, lightGlowBleed } from './glow'
import type { LayerEffectReference } from './layerEffectGeometry'
import { WHITE_HEX } from '../theme/colorTokens'

/** 大小 → 图案格子边长（画面高度的比例）：0 约 0.2%，30 约 0.6%，100 约 8%。 */
export function dissolveCellSize(value: number): number { return 0.002 * 40 ** (Math.max(0, value) / 100) }

/** 亮边真正会发光时（有亮边、还没完全显现）才算外扩。 */
export function dissolveRevealBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference): number {
  if (Number(params.edge_width ?? 0) <= 0 || Number(params.progress ?? 100) >= 100) return 0
  return lightGlowBleed(params, 1, ref)
}

const DESCRIPTION = '让内容按颗粒、点阵或半调网点一点点显现出来，也能反过来消散掉。给进度打关键帧：0% 到 100% 是显现，100% 到 0% 是消散。适合标题、图片和素材的出场与退场；正在显现的边缘可以带一圈亮边和光晕。'
const { amount, percent, choice, color } = effectParam

export const DISSOLVE_REVEAL_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  precision: (_params, plan) => plan.passes.some(pass => pass.entry !== 'copy' && pass.entry !== 'effect_opacity'),
  space: 'layer', author: { factory: 'dissolve' }, bleed: dissolveRevealBleed, id: 'dissolve_reveal', name: '溶解显影', group: 'stylize', description: DESCRIPTION,
  aliases: ['溶解', '显影', '消散', '颗粒溶解', 'dissolve', 'reveal'],
  params: [
    percent('progress', 50, 0, { name: '进度', text: '显现了多少。0% 完全看不见；50%（默认）出来一半；100% 完整显示，和没加效果一样。做消散就从 100% 调到 0%。' }),
    choice('mode', 'noise', [{ value: 'noise', label: '噪声' }, { value: 'dots', label: '点阵' }, { value: 'halftone', label: '半调' }], { name: '方式', text: '按什么图案显现。噪声（默认）细碎的颗粒随机冒出来，像照片显影；点阵是按方格排开的圆点各自先后长满；半调是整齐的网点一起长大，亮的地方先长满。' }),
    amount('size', 10, { group: '图案', name: '大小', text: '颗粒或网点有多大。0 约为画面高度的 0.2%，细得像胶片颗粒；10（默认）约 0.3%，细碎的颗粒；30 约 0.6%，噪声方式下连成斑纹；100 约 8%，大块的图案。' }),
    { key: 'seed', type: 'number', unit: 'value', min: 0, max: 9999, step: 1, default: 0, animatable: false, group: '图案', name: '随机种子', description: '换一个数，颗粒出现的先后就换一种排法，大小和节奏不变。同一画面上几处都用溶解时各填不同的数。', visibleWhen: { param: 'mode', in: ['noise', 'dots'] } },
    percent('softness', 30, 0, { group: '边缘', name: '柔和度', text: '每一点是一下子出现还是慢慢浮现。0% 一下子出现，最利落；30%（默认）稍有渐显；100% 整体接近淡入，图案若隐若现。' }),
    amount('edge_width', 0, { group: '边缘', name: '宽度', text: '正在显现的边缘带一圈亮边有多宽。0（默认）没有亮边，也没有光晕；20 细细的一圈；60 以上是宽的亮带，像燃烧的纸边。' }),
    color('edge_color', WHITE_HEX, { group: '边缘', name: '颜色', text: '亮边和它散出的光晕的颜色。宽度为 0 时不起作用。' }),
    ...includedLightGlowParams({
      radius: { default: 30, text: '光晕能散多远。0 只贴着亮边；30（默认）约为画面高度的 2%；100 能铺满大半个画面。' },
    }),
  ],
}
