/**
 * 漏光：一片不规则的暖光从画面一边渗进来，光形是低频、域扭曲的噪声场，随片段时间慢慢流动。
 * 实现在 `features/videoEdit/engine/lightLeak.ts`。按整幅画面算，只能加在片段与代码调整层上。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { VIDEO_EDIT_LIGHT_LEAK_DEFAULT_HEX } from '../theme/colorTokens'

/** 按帧取种子：光形流动或闪烁时返回帧位置（代码图层上可以带小数，慢放也逐帧在动）；不出光或既不流动也不闪烁时与帧无关，返回 0。规划只按这个值求时间。 */
export function lightLeakFrameSeed(params: VideoEditBuiltinParams, frame: number): number {
  return Number(params.amount ?? 0) > 0 && (Number(params.speed ?? 0) > 0 || Number(params.flicker ?? 0) > 0) ? frame : 0
}

const DESCRIPTION = '让一片不规则的暖光从画面一边渗进来，像胶片曝光时漏进的光。适合片头、回忆、转场附近的氛围；光的形状是流动的大片柔光，没有光斑。暗底上也平滑，不出一圈圈的色带。'
const { amount, percent, choice, color } = effectParam
const SIDES = [
  { value: 'top_left', label: '左上' }, { value: 'top', label: '上' }, { value: 'top_right', label: '右上' }, { value: 'right', label: '右' },
  { value: 'bottom_right', label: '右下' }, { value: 'bottom', label: '下' }, { value: 'bottom_left', label: '左下' }, { value: 'left', label: '左' },
]

export const LIGHT_LEAK_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  precision: (_params, plan) => plan.passes.some(pass => pass.entry !== 'copy'),
  space: 'frame', frameSeed: lightLeakFrameSeed, author: { factory: 'lightLeak' }, id: 'light_leak', name: '漏光', group: 'light', description: DESCRIPTION,
  aliases: ['胶片漏光', '光泄漏', '烧片', '暖光', 'light leak', 'film burn', 'leak'],
  params: [
    amount('amount', 50, { name: '强度', text: '漏光有多亮。0 没有；50（默认）一角明显泛暖；100 以上大半个画面被光冲淡，可以输入到 200。' }, 200),
    choice('side', 'top_left', SIDES, { name: '方向', text: '光从哪边渗进来。左上（默认）从左上角斜着进来；上、下、左、右从一条边进来，光沿着这条边铺开。' }),
    percent('spread', 50, 0, { group: '光', name: '范围', text: '光往画面里铺得多深。50%（默认）约到画面三分之一；20% 只贴着边缘一小片；100% 铺过大半个画面。' }),
    amount('streaks', 30, { group: '光', name: '条纹', text: '顺着光进来的方向的明暗条纹，像光从缝里透进来。0 一整片柔光；30（默认）隐约的几道；80 以上清楚的光带。' }),
    color('hot_color', VIDEO_EDIT_LIGHT_LEAK_DEFAULT_HEX.hot, { group: '颜色', name: '中心颜色', text: '光最亮处的颜色，暖白（默认）。很亮时还会更接近白色。' }),
    color('edge_color', VIDEO_EDIT_LIGHT_LEAK_DEFAULT_HEX.edge, { group: '颜色', name: '边缘颜色', text: '光渐渐变淡处的颜色，橙色（默认）；换成玫红、品红是更浓的胶片味。' }),
    percent('flicker', 20, 0, { group: '变化', name: '闪烁', text: '亮度一明一暗地起伏。0% 稳定不变；20%（默认）轻轻地呼吸；70% 以上明显地跳动。' }),
    { ...percent('speed', 30, 0, { group: '变化', name: '速度', text: '光形慢慢流动的快慢。0% 静止；30%（默认）几秒里缓缓变化；100% 流动得很明显。' }), animatable: false },
    { key: 'seed', type: 'number', unit: 'value', min: 0, max: 9999, step: 1, default: 0, animatable: false, group: '变化', name: '随机种子', description: '换一个数，光的形状和起伏就换一种，亮度和范围不变。同一部片子几处都用漏光时各填不同的数。' },
  ],
}
