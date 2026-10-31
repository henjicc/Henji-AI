/**
 * 描边：沿 alpha 0.5 的等值线描边。实现在 `features/videoEdit/engine/stroke.ts`（Jump Flood 距离场）。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import { effectParam } from './effectIncludes'
import type { LayerEffectReference } from './layerEffectGeometry'
import { BLACK_HEX } from '../theme/colorTokens'

/** 粗细 → 边宽（画面高度的比例）。指数曲线让滑块每一段的观感变化差不多：20 约 0.08%，50 约 0.43%，100 约 3.9%。 */
export function strokeWidth(value: number): number { return 0.0006 * Math.expm1(4.2 * Math.max(0, value) / 100) }

/**
 * 纹理像素下的几何：边宽 `width`、羽化宽 `feather`（至少 1 像素，就是抗锯齿）、
 * 从轮廓量起的半径 `radius`（外侧与内侧为 w，居中为 w/2）和覆盖能到的最远处 `reach`。
 */
export function strokeGeometry(params: VideoEditBuiltinParams, h: number): { width: number; feather: number; radius: number; reach: number } {
  const width = strokeWidth(Number(params.width ?? 0)) * h
  const feather = Math.max(1, Number(params.softness ?? 0) / 100 * width)
  const radius = params.position === 'center' ? width / 2 : width
  return { width, feather, radius, reach: radius + feather / 2 + 1 }
}

export function strokeBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference): number {
  if (Number(params.width ?? 0) <= 0 || params.position === 'inside') return 0
  const h = ref.referenceSize.height * ref.rasterScale
  return (strokeGeometry(params, h).reach + 1) / h
}

const DESCRIPTION = '沿内容的轮廓描一圈边，文字、图形、抠好的人物都能用。适合字幕描边、花字和贴纸白边。整幅不透明的画面会沿四边描成一个框。'
const { amount, percent, choice, color } = effectParam

export const STROKE_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', author: { factory: 'stroke' }, bleed: strokeBleed, id: 'stroke', name: '描边', group: 'stylize', description: DESCRIPTION,
  aliases: ['勾边', '轮廓线', '外描边', 'outline', 'stroke'],
  params: [
    amount('width', 50, { name: '粗细', text: '边有多粗。0 没有描边；20 发丝细线；50（默认）约为画面高度的 0.4%，常规字幕描边；100 约 4%，粗壮的贴纸边。可以输入到 120。' }, 120),
    color('color', BLACK_HEX, { name: '颜色', text: '边的颜色。黑色（默认）让浅色字在亮画面上也看得清；白色做贴纸边。' }),
    choice('position', 'outside', [{ value: 'outside', label: '外侧' }, { value: 'inside', label: '内侧' }, { value: 'center', label: '居中' }], { group: '边缘', name: '位置', text: '边描在轮廓的哪一侧。外侧（默认）不遮住内容，字形不变；内侧描在内容里面，外形不变大；居中跨在轮廓线上。' }),
    percent('softness', 0, 0, { group: '边缘', name: '柔和度', text: '边的外缘清楚还是发虚。0%（默认）清楚利落；30% 微微发虚；100% 整条边都在渐变，像一层柔光。' }),
    percent('opacity', 100, 0, { group: '边缘', name: '不透明度', text: '边有多实。100%（默认）实色；50% 半透明，透出后面的画面。' }),
    percent('source_opacity', 100, 0, { group: '边缘', name: '原画不透明度', text: '内容本身保留多少。100%（默认）；0% 只留下描边，做空心字。' }),
  ],
}
