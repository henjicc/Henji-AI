/**
 * 色差：红、绿、蓝分开错位，像镜头的色散或故障画面。
 * 实现在剪辑内置效果着色器（`features/videoEdit/engine/chromaticAberration.ts`）。
 * 发光等效果把它整组包含进来，只作用在自己的光晕上（见 `effectIncludes.ts`）。
 */
import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { effectParam } from './effectIncludes'

const DESCRIPTION = '把红、绿、蓝三种颜色错开，边缘出现彩色的边，像镜头的色散。适合做镜头质感、科技感和故障风。'

export const CHROMATIC_ABERRATION_DEFINITION: VideoEditBuiltinEffectDefinition = {
  id: 'chromatic_aberration', name: '色差', group: 'stylize', tooltip: DESCRIPTION, description: DESCRIPTION,
  params: [
    effectParam.amount('amount', 20, { name: '数量', text: '颜色错开多远。0 没有色差；20（默认）轻微的镜头感；60 明显的彩边；100 约为画面高度的 2%，故障风。' }),
    effectParam.choice('mode', 'radial', [{ value: 'radial', label: '从中心向外' }, { value: 'directional', label: '固定方向' }], { name: '方式', text: '从中心向外（默认）像真实镜头，越靠近画面边缘错得越开；固定方向让整个画面朝同一个方向错开，更像故障效果。' }),
    { ...effectParam.angle('angle', 0, { name: '角度', text: '固定方向时颜色错开的方向。0（默认）左右错开，90 上下错开。' }), visibleWhen: { param: 'mode', in: ['directional'] } },
    effectParam.choice('channels', 'red_blue', [{ value: 'red_blue', label: '红与蓝' }, { value: 'red_green', label: '红与绿' }, { value: 'green_blue', label: '绿与蓝' }], { name: '通道', text: '哪两种颜色分开：前一种往外偏，后一种往里偏，第三种不动。红与蓝（默认）外红内蓝，最像真实镜头。' }),
    effectParam.amount('smoothness', 50, { name: '柔和度', text: '彩边是清楚的三层重影还是柔和的彩虹过渡。0 三层颜色硬分开，像数码故障；50（默认）柔和；100 拉成连续的彩虹色带。' }),
  ],
}
