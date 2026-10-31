/**
 * 投影：按内容的 alpha 在后面投下一道影子。实现在 `features/videoEdit/engine/dropShadow.ts`。
 * 柔和度与“模糊”的模糊度同一把尺子（`blurSigma`），距离按画面高度换算，任何分辨率下看起来一样。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { blurSigma } from './blur'
import { gaussianSupport, type LayerEffectReference } from './layerEffectGeometry'
import { BLACK_HEX } from '../theme/colorTokens'

/** 柔和度能输入的上限：虚化约为画面高度的一半，再大已经看不出区别。 */
export const DROP_SHADOW_SOFTNESS_MAX = 200
/** 距离 → 偏移（画面高度的比例）：100 约 5%。 */
export function dropShadowOffset(distance: number): number { return Math.max(0, distance) * 0.0005 }

const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)

/**
 * 外扩：偏移加模糊的取样支撑，再留 2 像素。模糊的尾巴与“模糊”效果一样封顶在一个画面对角线：
 * 再往外只剩极淡的一层，不让很大的柔和度把图层纹理撑到设备上限。
 */
export function dropShadowBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference): number {
  if (n(params, 'opacity') <= 0) return 0
  const h = ref.referenceSize.height * ref.rasterScale
  const w = Math.ceil(ref.contentBounds.width * ref.rasterScale), bh = Math.ceil(ref.contentBounds.height * ref.rasterScale)
  const sigma = blurSigma(Math.min(DROP_SHADOW_SOFTNESS_MAX, n(params, 'softness'))) * h
  const cap = Math.hypot(ref.referenceSize.width, ref.referenceSize.height) / ref.referenceSize.height
  return dropShadowOffset(n(params, 'distance')) + Math.min(cap * h, sigma > 0 ? gaussianSupport(sigma, w, bh, ref.quality) : 0) / h + 2 / h
}

const DESCRIPTION = '在内容后面投下一道柔和的影子，让图层和背景之间拉开前后距离。适合标题、卡片、抠好的人物和画中画；影子按内容的形状算。整幅不透明的画面看不到投影，因为影子被画面自己挡住。'
const { amount, percent, angle, color } = effectParam

export const DROP_SHADOW_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  precision: (_params, plan) => plan.passes.some(pass => pass.entry !== 'copy' && pass.entry !== 'effect_opacity'),
  space: 'layer', author: { factory: 'shadow' }, bleed: dropShadowBleed, id: 'drop_shadow', name: '投影', group: 'outline', description: DESCRIPTION,
  aliases: ['阴影', '影子', '外阴影', 'drop shadow', 'shadow'],
  params: [
    percent('opacity', 40, 0, { name: '不透明度', text: '影子有多深。0 没有投影；40%（默认）淡淡的影子，像纸片稍稍离开桌面；80% 以上是浓重的影子。' }),
    amount('distance', 20, { name: '距离', text: '影子离内容多远。0 影子正好在内容正下方，只露出四周一圈；20（默认）约为画面高度的 1%；100 约 5%，像悬得很高。可以输入到 400。' }, 400),
    amount('softness', 40, { name: '柔和度', text: '影子的边缘有多虚。0 边缘清楚的硬影；40（默认）柔和，虚化约为画面高度的 1%；80 以上散成一大片淡影。和“模糊”的模糊度是同一把尺子，可以输入到 200。' }, DROP_SHADOW_SOFTNESS_MAX),
    angle('direction', 90, { name: '方向', text: '影子往哪边落。90°（默认）落在正下方，像光从正上方照下来；45° 右下；0° 正右；−90° 正上方。' }),
    color('color', BLACK_HEX, { group: '外观', name: '颜色', text: '影子的颜色。黑色（默认）最自然；在有颜色的背景上用背景色的深色，比纯黑更像真实的影子。' }),
    percent('spread', 0, 0, { group: '外观', name: '扩展', text: '影子的实心部分有多大。0%（默认）完全按柔和度渐变；50% 影子更实、更大一圈；100% 变成放大了一圈的硬边影子。' }),
    percent('source_opacity', 100, 0, { group: '外观', name: '原画不透明度', text: '内容本身保留多少。100%（默认）；0% 只留下影子，相当于 AE 的“仅阴影”，可以单独放一层再叠。' }),
  ],
}
