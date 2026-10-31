/**
 * 半调网点：按格子求平均色，再按明暗画大小不一的网点（每个像素看最近的四个格心，Gustavson 2011）。
 * 格子尺与溶解显影的“大小”同一把，套色偏移与投影的“距离”同一把；网格锚在内容中心，图层移动时跟着走。
 * 实现在 `features/videoEdit/engine/halftone.ts`。
 */
import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { BLACK_HEX, WHITE_HEX } from '../theme/colorTokens'

const DESCRIPTION = '把画面变成一格一格的网点，像印刷品。适合给照片、卡片和文字加印刷质感；单色网格始终正着排。'
const { amount, choice, color } = effectParam
const MONO = { param: 'mode', equals: 'mono' }
const DUO = { visibleWhen: { all: [MONO, { param: 'color_mode', equals: 'duo' }] } }

export const HALFTONE_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', author: { factory: 'halftone' }, id: 'halftone', name: '半调网点', group: 'texture', description: DESCRIPTION,
  aliases: ['半调', '网点', '印刷网点', '彩色半调', 'halftone', 'color halftone'],
  params: [
    amount('size', 40, { name: '网点大小', text: '每个网点格子多大。0 细到接近原画；40（默认）约为画面高度的 0.9%；100 约 8%，一颗颗大圆点。' }),
    choice('mode', 'mono', [{ value: 'mono', label: '单色' }, { value: 'cmyk', label: '彩色印刷' }], { name: '方式', text: '单色（默认）一层网点；彩色印刷用青、品红、黄、黑四色网点按印刷网角叠印在白纸上，近看有玫瑰斑。' }),
    choice('shape', 'dot', [{ value: 'dot', label: '圆点' }, { value: 'line', label: '线条' }], { group: '网点', name: '形状', text: '圆点（默认）；线条是一排排粗细随明暗变化的横线，彩色印刷时四色线条各斜一个网角。' }),
    amount('contrast', 50, { group: '网点', name: '对比度', text: '网点大小随明暗变化得多明显。50（默认）照原画明暗；调高暗处更实、亮处更空；调低网点大小更接近，画面发灰。' }),
    { ...choice('color_mode', 'original', [{ value: 'original', label: '原色' }, { value: 'duo', label: '双色' }], { group: '颜色', name: '颜色', text: '原色（默认）网点用原画颜色，亮处网点大，网点之间透明，适合暗底；双色是墨印在纸上，暗处墨点大。' }), visibleWhen: MONO },
    { ...color('ink', BLACK_HEX, { group: '颜色', name: '墨色', text: '双色时网点的颜色。黑色（默认）像报纸；换成深蓝、深红就是单色套印。' }), ...DUO },
    { key: 'paper', type: 'color', default: WHITE_HEX, alpha: true, animatable: true, group: '颜色', name: '纸色', description: '双色时网点下面的纸是什么颜色。白色（默认）；设成透明只留下墨点，可以叠在别的画面上。', ...DUO },
    { ...amount('misregister', 0, { group: '颜色', name: '套色偏移', text: '四色版错开多远，像没对准的印刷。0（默认）对齐；10 约为画面高度的 0.5%，边上露出彩边；100 约 5%。' }), visibleWhen: { param: 'mode', equals: 'cmyk' } },
  ],
}
