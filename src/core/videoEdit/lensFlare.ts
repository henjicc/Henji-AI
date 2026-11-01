/**
 * 镜头光晕：在画面里放一个强光源，光核、星芒、横向拉丝与鬼影都由光源位置解析求出，光晕交给发光的同一套金字塔。
 * 实现在 `features/videoEdit/engine/lensFlare.ts`。按整幅画面算，只能加在片段与代码调整层上。
 */
import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { WHITE_HEX } from '../theme/colorTokens'

const DESCRIPTION = '在画面里放一个强光源，带光晕、星芒和横向拉丝，像镜头正对着灯。适合片头、产品定版和逆光的氛围；光源可以放到画外，让光从边上漏进来。鬼影（一串圆形光斑）默认关闭，需要老镜头味道时再加。'
const { amount, color } = effectParam
const position = (key: string, value: number, name: string, text: string): VideoEditBuiltinEffectDefinition['params'][number] =>
  ({ key, type: 'number', unit: 'percent', min: -100, max: 200, softMin: 0, softMax: 100, step: 1, default: value, animatable: true, name, description: text })

export const LENS_FLARE_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  precision: (_params, plan) => plan.passes.some(pass => pass.entry !== 'copy'),
  space: 'frame', author: { factory: 'lensFlare' }, id: 'lens_flare', name: '镜头光晕', group: 'light', description: DESCRIPTION,
  aliases: ['镜头炫光', '炫光', '耀斑', '星芒', '光源', 'lens flare', 'flare', 'sun flare'],
  params: [
    amount('brightness', 60, { name: '亮度', text: '光源有多亮。0 没有光；30 柔和的一点灯光；60（默认）明显的强光，中心发白；100 以上中心大片发白，可以输入到 400。' }, 400),
    position('light_x', 25, '光源位置（水平）', '光源在画面里左右的位置。0% 在左边缘，100% 在右边缘，25%（默认）偏左；可以输入画外的值，例如 120%，光从右边漏进来。'),
    position('light_y', 25, '光源位置（垂直）', '光源上下的位置。0% 在顶边，100% 在底边，25%（默认）偏上；输入负数光源到画面上方。'),
    color('color', WHITE_HEX, { name: '颜色', text: '光的颜色，光晕、星芒、拉丝和鬼影一起变。白色（默认）；暖黄像夕阳，淡蓝像冷光灯。很亮时中心仍会发白。' }),
    amount('size', 60, { group: '光芒', name: '光晕大小', text: '光晕散多远，和发光的半径同一把尺子。0 只剩贴着光源的一小团；30 约为画面高度的 2%；60（默认）约 8%，四周一圈柔和的光雾；100 能铺满大半个画面。' }, 150),
    amount('rays', 20, { group: '光芒', name: '星芒', text: '光源周围放射的细光线有多明显。0 没有；20（默认）淡淡的几道；60 以上清楚的星形光芒。' }),
    { key: 'ray_count', type: 'number', unit: 'value', min: 2, max: 32, softMin: 2, softMax: 16, step: 1, default: 6, animatable: false, group: '光芒', name: '星芒数量', description: '星芒有几道。4 是十字；6（默认）像六叶光圈拍出的星芒；8 以上更细密。星芒为 0 时不起作用。' },
    amount('streak', 30, { group: '光芒', name: '横向拉丝', text: '一条横贯画面的细长光线，像宽银幕镜头。0 没有；30（默认）淡淡一条；70 以上明显的光条，亮度越高拉得越长。' }),
    amount('ghosts', 0, { group: '鬼影', name: '鬼影', text: '沿光源和画面中心的连线排开的一串淡淡的圆形光斑，像老镜头里的反射。0（默认）没有；30 隐约可见；70 以上很明显。' }),
    amount('ghost_dispersion', 30, { group: '鬼影', name: '色散', text: '鬼影边缘的彩虹色。0 没有彩边；30（默认）淡淡的一圈；100 明显的彩虹边。鬼影为 0 时不起作用。' }),
  ],
}
