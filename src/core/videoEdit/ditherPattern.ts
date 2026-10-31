/**
 * 抖动点阵：把画面按“像素大小”分格求平均，再用固定阈值图案（8×8 方格或 64×64 蓝噪声）把每格压成几级颜色，
 * 最近邻放大。图案锚在内容左上角，静止画面每帧结果相同。实现在 `features/videoEdit/engine/ditherPattern.ts`。
 */
import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { BLACK_HEX, WHITE_HEX } from '../theme/colorTokens'

/** 像素大小 → 点的边长（画面高度的比例）：0 约 0.1%，20 约 0.2%，100 约 3.2%。 */
export function ditherPixelSize(value: number): number { return 0.001 * 2 ** (Math.max(0, value) / 20) }

const DESCRIPTION = '用规则排列的像素点把画面压成几种颜色，像老式电脑与掌机画面。适合像素风标题、复古游戏感的素材；静止时点阵不闪。'
const { amount, percent, choice, color } = effectParam
const DUO = { visibleWhen: { param: 'color_mode', equals: 'duo' } }

export const DITHER_PATTERN_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', author: { factory: 'ditherPattern' }, id: 'dither_pattern', name: '抖动点阵', group: 'texture', description: DESCRIPTION,
  aliases: ['抖动', '仿色', '像素抖动', '1-bit', 'dither', 'dithering'],
  params: [
    amount('pixel_size', 20, { name: '像素大小', text: '每个点多大。0 约为画面高度的 0.1%，最细的点；20（默认）约 0.2%；100 约 3%，大颗马赛克点。' }),
    choice('pattern', 'bayer', [{ value: 'bayer', label: '方格' }, { value: 'blue_noise', label: '蓝噪声' }], { name: '图案', text: '点怎么排。方格（默认）整齐的网纹，像老游戏机；蓝噪声细碎均匀、没有纹路。' }),
    { key: 'levels', type: 'number', unit: 'value', min: 2, max: 16, softMin: 2, softMax: 8, step: 1, default: 2, animatable: true, group: '颜色', name: '色阶', description: '每种颜色留几级。2（默认）只有暗色和亮色；4 多出两级中间色；8 以上接近原画的明暗。' },
    choice('color_mode', 'duo', [{ value: 'duo', label: '双色' }, { value: 'original', label: '原色' }], { group: '颜色', name: '颜色', text: '双色（默认）只用暗色与亮色；原色按原画的颜色分级，色阶 2 时只剩红绿蓝、青品黄和黑白八种颜色。' }),
    { ...color('dark', BLACK_HEX, { group: '颜色', name: '暗色', text: '双色时暗处点的颜色。黑色（默认）；换成深绿、深蓝像老掌机的屏幕。' }), ...DUO },
    { ...color('light', WHITE_HEX, { group: '颜色', name: '亮色', text: '双色时亮处点的颜色。白色（默认）；换成浅绿、米黄像老掌机的屏幕。' }), ...DUO },
    percent('threshold', 50, 0, { group: '颜色', name: '阈值', text: '整体偏暗还是偏亮。50%（默认）照原画；调高更多点变暗；调低更多点变亮。' }),
  ],
}
