/**
 * 发光：亮的地方向外散出物理感的光晕。
 * 实现在剪辑内置效果着色器（`features/videoEdit/engine/glow.ts`），预览与导出同一路径。
 *
 * 光晕按倍频程叠加多层高斯：每层半径翻倍、能量乘“拖尾”系数。拖尾 100 时每层能量相同，
 * 光强随距离按平方反比衰减，与真实镜头和人眼的散射一致；半径只决定这条尾巴截在多远。
 * 色差直接包含“色差”效果，只作用在光晕上。
 */
import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { WHITE_HEX } from '../theme/colorTokens'
import { CHROMATIC_ABERRATION_DEFINITION } from './chromaticAberration'
import { effectParam, includedEffectParams } from './effectIncludes'

/** 发光里包含的色差参数的键前缀。 */
export const GLOW_ABERRATION_PREFIX = 'aberration'

const DESCRIPTION = '让亮的地方向外散出柔和的光晕，越靠近越亮，强光的中心会发白。适合灯光、霓虹和高光；把阈值调到 0，所有内容都发光，可以给文字、图形和 Logo 加外发光。透明底的内容也能向外发光。'
const { amount, signed, percent, angle, choice, color, toggle } = effectParam

export const GLOW_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  id: 'glow', name: '发光', group: 'stylize', tooltip: DESCRIPTION, description: DESCRIPTION,
  params: [
    amount('strength', 40, { name: '强度', text: '光晕有多亮。0 不发光；20 含蓄的柔光；40（默认）明显的光晕；70 以上是强烈的霓虹辉光。' }),
    amount('radius', 60, { name: '半径', text: '光晕能散多远。0 只贴着边缘一圈；60（默认）约为画面高度的 8%；100 能铺满大半个画面。只改变散开的距离，中心亮度基本不变。' }),
    amount('threshold', 60, { group: '输入', name: '阈值', text: '画面里多亮的地方才发光。0 所有内容都发光（给文字加外发光时用）；60（默认）只有明显的亮部；85 以上只剩灯光、反光这类最亮处。' }),
    amount('threshold_smoothness', 30, { group: '输入', name: '阈值平滑度', text: '阈值附近是一刀切还是慢慢过渡。0 刚过阈值才发光，边界生硬；30（默认）自然；100 接近阈值的部分也微微发光。' }),
    amount('falloff', 70, { group: '光晕', name: '拖尾', text: '远处的光留得多少。0 光集中在近处，很快消失；70（默认）自然的光雾；100 远处留下大片淡光，最像真实镜头。' }),
    amount('core_white', 50, { group: '光晕', name: '核心发白', text: '很亮的彩色光，中心有多容易变白，像曝光过度。0 保持原来的颜色；50（默认）自然；100 强光中心明显发白。' }),
    choice('blend', 'add', [{ value: 'add', label: '相加' }, { value: 'screen', label: '滤色' }], { group: '光晕', name: '混合模式', text: '光晕怎样叠到画面上。相加（默认）像真实的光，亮处更亮、强光会变白；滤色更柔和，不容易过曝。' }),
    signed('aspect', 0, { group: '长宽比', name: '长宽比', text: '把光晕拉成横向或竖向的光带，像宽银幕镜头。0（默认）圆形；往正调横向拉长，50 约 3 倍、100 拉成 8 倍长的光条；往负调竖向拉长。' }),
    angle('angle', 0, { group: '长宽比', name: '角度', text: '把拉长的方向再转一个角度，用来斜着拉。0（默认）不转。长宽比为 0 时不起作用。' }),
    ...includedEffectParams(CHROMATIC_ABERRATION_DEFINITION, GLOW_ABERRATION_PREFIX, '色差', { amount: 0 }),
    amount('tint', 0, { group: '着色', name: '着色量', text: '把光晕换成下面的颜色的程度。0（默认）保持发光内容本来的颜色；100 完全换成从内圈到外圈的颜色。白字配彩色光晕时设 100。' }),
    color('tint_inner', WHITE_HEX, { group: '着色', name: '内圈颜色', text: '靠近发光内容的光晕颜色。着色量为 0 时不起作用。' }),
    color('tint_outer', WHITE_HEX, { group: '着色', name: '外圈颜色', text: '远处光晕的颜色，从内圈颜色渐变过来；和内圈颜色相同就是单色光晕。着色量为 0 时不起作用。' }),
    // 分辨率不做动画：每换一次都要重新分配全部中间纹理。
    { ...percent('resolution', 50, 25, { group: '质量', name: '分辨率', text: '光晕按画面多大的分辨率计算。50%（默认）又快又好；100% 贴近内容的光更细腻，细小亮点在运动中更稳，计算量约为默认的三倍；25% 最快，近处的光略糊。亮度和光晕大小不随它变。' }), animatable: false },
    amount('dither', 50, { group: '质量', name: '抖动', text: '给光晕加极细的噪点，盖住平滑渐变里一圈圈的色带。0 关闭；50（默认）刚好看不出噪点；100 色带最少，但暗处能看到细微的颗粒。' }),
    toggle('dither_mono', false, { group: '质量', name: '单色抖动', text: '抖动的噪点只改变明暗、不带颜色。默认关闭，彩色噪点更不容易被看出来。' }),
    percent('source_opacity', 100, 0, { group: '输出', name: '原画不透明度', text: '原来的画面还保留多少。100%（默认）光晕加在原画上；0% 只留下光晕，适合单独放一层再叠加。' }),
    choice('view', 'final', [{ value: 'final', label: '最终效果' }, { value: 'source', label: '发光来源' }], { group: '输出', name: '视图', text: '最终效果（默认）显示加了光晕的画面；发光来源只显示过了阈值、会发光的部分，用来检查阈值调得对不对。' }),
  ],
}
