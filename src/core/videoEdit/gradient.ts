/**
 * 渐变：生成器（“生成”文件夹），原生工序在 `features/videoEdit/engine/gradient.ts`。
 * 位置按内容框百分比，距离在像素空间里算，径向是正圆；在内容 alpha 内按混合模式生成。
 * 非纯色时整帧走高精度，末道转换按最终画面抖动，效果里不再抖动。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParam, VideoEditBuiltinParams } from './builtinEffects'
import { effectParam, type EffectParamText } from './effectIncludes'
import { BLACK_HEX, DARK_GRAY_HEX, LIGHT_GRAY_HEX, WHITE_HEX } from '../theme/colorTokens'

const { choice, color, percent } = effectParam
const TWO_COLORS = { visibleWhen: { param: 'mode', in: ['linear', 'radial', 'conic', 'diamond'] } }
const WITH_END = { visibleWhen: { param: 'mode', in: ['linear', 'radial', 'diamond'] } }
const CONIC = { visibleWhen: { param: 'mode', in: ['conic'] } }
const POINTS = { visibleWhen: { param: 'mode', in: ['points'] } }

const alphaColor = (key: string, value: string, words: EffectParamText): VideoEditBuiltinParam => ({ ...color(key, value, words), alpha: true } as VideoEditBuiltinParam)
/** 内容框或画面的百分比位置：0 左/上边缘，100 右/下边缘；可以输入到框外。 */
export const percentPosition = (key: string, value: number, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'number', unit: 'percent', min: -100, max: 200, softMin: 0, softMax: 100, step: 0.1, default: value, animatable: true, name: words.name, description: words.text, ...(words.group ? { group: words.group } : {}) })

const POINT_DEFAULTS = [[BLACK_HEX, 0, 0], [DARK_GRAY_HEX, 100, 0], [LIGHT_GRAY_HEX, 0, 100], [WHITE_HEX, 100, 100]] as const
const POINT_NAMES = ['左上', '右上', '左下', '右下']
const pointParams = POINT_DEFAULTS.flatMap(([value, x, y], index) => {
  const group = `点 ${index + 1}`
  return [
    { ...alphaColor(`p${index + 1}_color`, value, { group, name: '颜色', text: `这个颜色点的颜色。默认放在${POINT_NAMES[index]}角，四个点从黑、深灰、浅灰到白。` }), ...POINTS },
    { ...percentPosition(`p${index + 1}_x`, x, { group, name: '水平位置', text: '颜色点离左边多远，按内容宽度的百分比。0 左边缘，100 右边缘；可以放到框外，只留一点颜色渗进来。' }), ...POINTS },
    { ...percentPosition(`p${index + 1}_y`, y, { group, name: '垂直位置', text: '颜色点离上边多远，按内容高度的百分比。0 上边缘，100 下边缘。' }), ...POINTS },
  ]
})

/** 渐变是否不是一种颜色：只有非纯色才需要高精度。 */
export function gradientVaries(params: VideoEditBuiltinParams): boolean {
  if (params.mode === 'points') return new Set([1, 2, 3, 4].map(index => String(params[`p${index}_color`]).toLowerCase())).size > 1
  return String(params.start_color).toLowerCase() !== String(params.end_color).toLowerCase()
}

const DESCRIPTION = '生成平滑的颜色渐变，做背景、卡片底色或叠在内容上。在高精度里算，暗底上的大面积渐变也不出色带。加在片段或图形上时只在它的范围里生成，圆角卡片加上渐变就是渐变卡片。'

export const GRADIENT_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  stage: 'generator', space: 'layer', author: { factory: 'gradient' }, precision: gradientVaries,
  frameSeed: (params, frame) => params.mode === 'points' && Number(params.drift) > 0 && gradientVaries(params) ? frame : 0,
  id: 'gradient', name: '渐变', group: 'generator', description: DESCRIPTION,
  aliases: ['渐变叠加', '线性渐变', '径向渐变', '角向渐变', '菱形渐变', '多点渐变', '网格渐变', '流动渐变', '色轮', '梯度渐变', 'gradient', 'gradient ramp', 'mesh gradient', 'linear gradient', 'radial gradient'],
  params: [
    choice('mode', 'linear', [
      { value: 'linear', label: '线性' }, { value: 'radial', label: '径向' }, { value: 'conic', label: '角向' },
      { value: 'diamond', label: '菱形' }, { value: 'points', label: '多点' },
    ], { name: '方式', text: '渐变的形状。线性（默认）从起点到终点；径向从起点向外一圈圈；角向绕起点转一圈；菱形向外成菱形；多点让四个颜色点按远近融合，像网格渐变。' }),
    { ...alphaColor('start_color', BLACK_HEX, { name: '起点颜色', text: '起点一端的颜色，可以带透明度。黑色（默认）到白色的终点。' }), ...TWO_COLORS },
    { ...alphaColor('end_color', WHITE_HEX, { name: '终点颜色', text: '终点一端的颜色，可以带透明度。白色（默认）；两端同色就是纯色。' }), ...TWO_COLORS },
    { ...percentPosition('start_x', 50, { group: '位置', name: '起点（水平）', text: '起点离左边多远，按内容宽度的百分比。50（默认）居中；径向和角向渐变以它为中心。' }), ...TWO_COLORS },
    { ...percentPosition('start_y', 0, { group: '位置', name: '起点（垂直）', text: '起点离上边多远，按内容高度的百分比。0（默认）上边缘，配合终点 100 就是从上到下。' }), ...TWO_COLORS },
    { ...percentPosition('end_x', 50, { group: '位置', name: '终点（水平）', text: '终点离左边多远，按内容宽度的百分比。50（默认）居中。径向渐变里起点到终点的距离就是半径。' }), ...WITH_END },
    { ...percentPosition('end_y', 100, { group: '位置', name: '终点（垂直）', text: '终点离上边多远，按内容高度的百分比。100（默认）下边缘。' }), ...WITH_END },
    { ...effectParam.angle('angle', 0, { group: '位置', name: '起始角度', text: '角向渐变从哪个方向开始，顺时针转一圈回到这里。0°（默认）从起点正右方开始；90° 从正下方开始。' }), ...CONIC },
    ...pointParams,
    { key: 'midpoint', type: 'number', unit: 'percent', min: 1, max: 99, step: 1, default: 50, animatable: true, group: '颜色', name: '中点', description: '两种颜色各占一半的位置。50%（默认）居中；调到 20%，终点颜色占得多；80% 起点颜色占得多。', ...TWO_COLORS },
    choice('interpolation', 'perceptual', [{ value: 'perceptual', label: '感知' }, { value: 'srgb', label: '标准' }], { group: '颜色', name: '插值', text: '颜色之间怎么过渡。感知（默认）过渡均匀，两种彩色之间不发灰；标准与网页 CSS 渐变一致。' }),
    { ...choice('repeat', 'none', [{ value: 'none', label: '不重复' }, { value: 'repeat', label: '重复' }, { value: 'mirror', label: '往返' }], { group: '颜色', name: '重复', text: '走到终点之后怎样。不重复（默认）停在终点颜色；重复从头再来；往返来回过渡。角向渐变选往返，转一圈首尾无缝接上。' }), ...TWO_COLORS },
    { ...percent('drift', 0, 0, { group: '颜色', name: '漂移', text: '多点方式下颜色点缓慢游动，做流动的背景。0（默认）静止；15 轻轻浮动；100 每个点在约 3% 画面高度里来回游。' }), animatable: false, ...POINTS },
    choice('blend_mode', 'normal', [
      { value: 'normal', label: '正常' }, { value: 'multiply', label: '正片叠底' }, { value: 'screen', label: '滤色' },
      { value: 'overlay', label: '叠加' }, { value: 'soft_light', label: '柔光' },
    ], { group: '输出', name: '混合模式', text: '渐变怎样叠在内容上。正常（默认）在内容范围内直接换成渐变，渐变透明处内容也透明；正片叠底只压暗，滤色只提亮，叠加、柔光加强明暗。透明的渐变颜色在后几种方式里是减弱作用。' }),
  ],
}
