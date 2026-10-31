/**
 * 扫光：一道光带沿“角度”方向扫过内容，只照亮内容本身；包含发光，让扫过的光再散出光晕。
 * 实现在 `features/videoEdit/engine/lightSweep.ts`。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { includedLightGlowParams, lightGlowBleed } from './glow'
import type { LayerEffectReference } from './layerEffectGeometry'
import { WHITE_HEX } from '../theme/colorTokens'

/** 宽度 → 光带全宽（画面高度的比例）：0 约 0.4%，50 约 4%，100 约 40%。 */
export function lightSweepWidth(value: number): number { return 0.004 * 100 ** (Math.max(0, value) / 100) }

/** 光的峰值（线性光）：亮度乘颜色最亮的通道。 */
export function lightSweepPeak(params: VideoEditBuiltinParams): number {
  const hex = typeof params.color === 'string' ? params.color : WHITE_HEX
  const peak = Math.max(...[1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255))
  return Number(params.intensity ?? 0) / 100 * peak ** 2.2
}

export function lightSweepBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference): number { return lightGlowBleed(params, lightSweepPeak(params), ref) }

const DESCRIPTION = '让一道光从文字或 Logo 上扫过，只照亮内容本身。适合标题出场、Logo 定版的点睛；给进度打关键帧从 0% 到 100% 就是扫一遍。纯白的字本身已经最亮，扫过时靠“发光”组贴着笔画的一圈亮边看出来。'
const { amount, percent, angle, color } = effectParam

export const LIGHT_SWEEP_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  precision: (_params, plan) => plan.passes.some(pass => pass.entry !== 'copy' && pass.entry !== 'effect_opacity'),
  space: 'layer', author: { factory: 'lightSweep' }, bleed: lightSweepBleed, id: 'light_sweep', name: '扫光', group: 'light', description: DESCRIPTION,
  aliases: ['流光', '光泽', '反光', 'light sweep', 'shine'],
  params: [
    percent('progress', 50, 0, { name: '进度', text: '光扫到哪里。0% 光还在内容外面没进来，100% 已经完全扫出去；50%（默认）在正中。打两个关键帧从 0% 到 100% 就是完整扫一遍，首尾都不会多出光。' }),
    amount('width', 70, { name: '宽度', text: '光带有多宽。0 一条细亮线；40 约为画面高度的 2.5%；70（默认）约 10%，一道清楚的光带；100 约 40%，一大片柔光掠过。' }),
    angle('angle', 30, { name: '角度', text: '光往哪个方向扫，光带和它垂直。0° 从左往右、光带竖直；30°（默认）往右下扫、光带向右倾斜；90° 从上往下扫。' }),
    color('color', WHITE_HEX, { group: '光', name: '颜色', text: '光的颜色。白色（默认）；金色、淡蓝做出金属或冷光的质感。' }),
    amount('intensity', 100, { group: '光', name: '亮度', text: '光有多亮。0 没有光；50 含蓄的高光；100（默认）明显的高光，彩色的字中心发白；200 以上接近曝光过度。可以输入到 400。' }, 400),
    percent('feather', 60, 0, { group: '光', name: '边缘柔和', text: '光带两边利落还是渐隐。0% 边缘清楚的光条；60%（默认）中间亮、两边柔和地暗下去；100% 整条都是渐变。' }),
    ...includedLightGlowParams({
      strength: { default: 40, text: '从扫过的光里散出的光晕有多亮。0 不加光晕；40（默认）光带经过处贴着笔画的一圈亮边，纯白的字靠它看出光扫过；70 以上明显的辉光。' },
      radius: { default: 12, text: '光晕能散多远。0 只贴着内容；12（默认）约为画面高度的 0.7%，紧贴笔画；40 约 3%，柔和的光雾；100 能铺满大半个画面。' },
    }),
  ],
}
