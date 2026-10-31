/**
 * 颜色映射：渐变映射、色调分离，逐点一道，实现在 `features/videoEdit/engine/colorMaps.ts`。
 * 颜色小组的新效果（含胶片模拟）从这里一起登记进索引；显示顺序由 `effectCatalog.ts` 决定。
 */
import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { BLACK_HEX, MID_GRAY_HEX, WHITE_HEX } from '../theme/colorTokens'
import { effectParam } from './effectIncludes'
import { FILM_LOOK_EFFECT_DEFINITION } from './filmLook'

const { percent, choice, color } = effectParam
const THREE = { visibleWhen: { param: 'mode', in: ['three'] } }

export const GRADIENT_MAP_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  stage: 'point', space: 'layer', author: { factory: 'gradientMap' }, id: 'gradient_map', name: '渐变映射', group: 'color',
  aliases: ['双色调', '三色调', '色调映射', 'duotone', 'tritone', 'gradient map'],
  description: '按明暗把画面换成两三种颜色，暗处用暗部颜色、亮处用亮部颜色。适合给照片、录屏或整组图层统一成一种色调。',
  params: [
    choice('mode', 'two', [{ value: 'two', label: '双色' }, { value: 'three', label: '三色' }], { name: '方式', text: '用几种颜色。双色（默认）从暗部颜色过渡到亮部颜色；三色在中间多一个中间调颜色。' }),
    color('dark_color', BLACK_HEX, { name: '暗部颜色', text: '最暗处换成的颜色。黑色（默认）配白色的亮部，就是按人眼明暗变成黑白；换成深蓝、深棕，暗部就带上这种色调。' }),
    color('light_color', WHITE_HEX, { name: '亮部颜色', text: '最亮处换成的颜色。白色（默认）；换成暖白、浅黄，高光和亮部就偏暖。' }),
    { ...color('mid_color', MID_GRAY_HEX, { group: '渐变', name: '中间调颜色', text: '中等明暗处换成的颜色。灰色（默认）与黑白两端一起就是黑白；换成彩色，中间调就是这个颜色。' }), ...THREE },
    { ...percent('mid_point', 50, 0, { group: '渐变', name: '中间调位置', text: '中间调颜色落在多亮的地方。50%（默认）正中；30% 偏暗处，更多画面接近亮部颜色；70% 偏亮处，更多画面接近暗部颜色。' }), ...THREE },
    choice('interpolation', 'perceptual', [{ value: 'perceptual', label: '感知' }, { value: 'srgb', label: '标准' }], { group: '渐变', name: '插值', text: '颜色之间怎么过渡。感知（默认）过渡均匀，两种彩色之间不发灰发脏；标准与网页 CSS 渐变一致。' }),
    percent('black_point', 0, 0, { group: '色阶', name: '黑场', text: '比它还暗的地方都用暗部颜色。0%（默认）只有纯黑才是暗部颜色；调到 20%，暗部更实、反差更大。' }),
    percent('white_point', 100, 0, { group: '色阶', name: '白场', text: '比它还亮的地方都用亮部颜色。100%（默认）只有纯白才是亮部颜色；调到 80%，亮部更通透。' }),
  ],
}

export const POSTERIZE_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  stage: 'point', space: 'layer', author: { factory: 'posterize' }, id: 'posterize', name: '色调分离', group: 'color',
  aliases: ['海报化', '色阶分离', '丝网印刷', 'posterize'],
  description: '把颜色压成几个台阶，做出海报、丝网印刷般的扁平色块。适合扁平插画感的画面和图层。',
  params: [
    { key: 'levels', name: '色阶', type: 'number', unit: 'value', min: 2, max: 64, softMin: 2, softMax: 16, step: 1, default: 6, animatable: true, description: '每个颜色留几级。2 只剩最亮最暗；6（默认）明显的色块；16 接近原画。可以输入到 64。' },
    choice('by', 'channels', [{ value: 'channels', label: '按通道' }, { value: 'luminance', label: '按亮度' }], { name: '分离方式', text: '分哪些。按通道（默认）颜色和明暗都分级，色块颜色更少更纯；按亮度只分明暗，保留原来的色相。' }),
    percent('smooth', 0, 0, { name: '平滑', text: '台阶之间硬切还是柔和过渡。0%（默认）硬边；50% 色块边缘柔一些；100% 台阶之间连成柔和的起伏。' }),
  ],
}

export const COLOR_MAP_EFFECT_DEFINITIONS: readonly VideoEditBuiltinEffectDefinition[] = [GRADIENT_MAP_EFFECT_DEFINITION, POSTERIZE_EFFECT_DEFINITION, FILM_LOOK_EFFECT_DEFINITION]
