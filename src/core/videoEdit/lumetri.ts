import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParam, VideoEditBuiltinParams } from './builtinEffects'

const signed = (key: string, name: string, description: string): VideoEditBuiltinParam => ({ key, name, type: 'number', unit: 'strength', min: -100, max: 100, step: 1, default: 0, tooltip: description, description })
const positive = (key: string, name: string, description: string, fallback = 0): VideoEditBuiltinParam => ({ key, name, type: 'number', unit: 'strength', min: 0, max: 100, step: 1, default: fallback, tooltip: description, description })
const hue = (key: string, name: string): VideoEditBuiltinParam => ({ key, name, type: 'number', unit: 'degrees', min: 0, max: 360, step: 1, default: 0, tooltip: '0° 红、60° 黄、120° 绿、180° 青、240° 蓝、300° 洋红；强度为 0 时不染色', description: '染色色相角：0 红、60 黄、120 绿、180 青、240 蓝、300 洋红；与对应 strength 一起写入。' })

export const LUMETRI_BASIC_PARAMS: readonly VideoEditBuiltinParam[] = [
  signed('temperature', '色温', '正值偏暖，负值偏冷；0 不变，常用 ±20。'), signed('tint', '色调', '正值偏洋红，负值偏绿；0 不变。'),
  { key: 'exposure', name: '曝光', type: 'number', unit: 'stops', min: -4, max: 4, step: 0.1, default: 0, tooltip: '每增加 1 档，线性光亮度翻倍', description: '线性曝光档：0 不变，+1 翻倍，-1 减半；常用 ±1。' },
  signed('contrast', '对比度', '正值增强明暗反差，负值减弱；0 不变。'), signed('highlights', '高光', '正值提亮亮部，负值恢复高光；0 不变。'), signed('shadows', '阴影', '正值提亮暗部，负值压暗；0 不变。'), signed('whites', '白色', '调整最亮区域；正值更亮，负值压低白点。'), signed('blacks', '黑色', '调整最暗区域；正值抬黑，负值加深黑色。'), signed('saturation', '饱和度', '-100 黑白，0 不变，+100 饱和度翻倍。'), signed('vibrance', '自然饱和度', '优先调整低饱和颜色，减少对鲜艳颜色的影响；0 不变。'),
]
export const LUMETRI_CREATIVE_PARAMS: readonly VideoEditBuiltinParam[] = [positive('faded_film', '淡化胶片', '抬起黑色并压缩反差；0 不变。'), positive('sharpen', '锐化', '增强边缘细节；0 不变，20 轻微提清晰度。'), hue('creative_shadow_hue', '阴影色相'), positive('creative_shadow_strength', '阴影染色', '阴影色调分离强度；0 不染色。'), hue('creative_highlight_hue', '高光色相'), positive('creative_highlight_strength', '高光染色', '高光色调分离强度；0 不染色。')]
export const LUMETRI_CURVE_CHANNELS = ['master', 'red', 'green', 'blue'] as const
export const LUMETRI_HUE_CURVES = ['hue_sat', 'hue_hue', 'hue_luma', 'luma_sat', 'sat_sat'] as const
export const LUMETRI_HUE_CURVE_NAMES = ['色相与饱和度', '色相与色相', '色相与亮度', '亮度与饱和度', '饱和度与饱和度'] as const
export const LUMETRI_POINT_PARAMS: readonly VideoEditBuiltinParam[] = [...LUMETRI_CURVE_CHANNELS, ...LUMETRI_HUE_CURVES].map((channel, i) => ({ key: `curve_${channel}_points`, name: i < 4 ? `${['RGB 主', '红', '绿', '蓝'][i]}控制点` : LUMETRI_HUE_CURVE_NAMES[i - 4], type: 'curve', default: '', tooltip: '单击加点，横纵拖动；右键或拖出删除。', description: `2–32个{x,y}控制点的JSON数组，x/y为0–100百分比，x严格递增。${i < 4 ? 'y为输出亮度，空字符串沿用旧curve_' + channel + '_0至_4五点（及其关键帧）。' : 'y=50不变，0/100为最大减弱/增强；色相横轴0红、33绿、67蓝、100红，两端y必须相等。'} 新曲线整体关键帧仅支持hold；旧五点数值动画保持原插值。` }))
export const LUMETRI_LUT_PARAMS: readonly VideoEditBuiltinParam[] = [
  ...['input', 'look'].flatMap(stage => [{ key: `${stage}_lut`, name: stage === 'input' ? '输入 LUT' : '创意 Look', type: 'lut' as const, default: '', tooltip: '选择已导入的 .cube 文件', description: '引用video_edit.document.lumetri_luts中的id，禁止文件路径；空字符串关闭。' }, positive(`${stage}_lut_strength`, stage === 'input' ? '输入 LUT 强度' : 'Look 强度', '0保持原色，100完全应用LUT。', 100)]),
]
export const LUMETRI_CURVE_PARAMS: readonly VideoEditBuiltinParam[] = LUMETRI_CURVE_CHANNELS.flatMap((channel, c) => Array.from({ length: 5 }, (_, i) => positive(`curve_${channel}_${i}`, `${['RGB 主', '红', '绿', '蓝'][c]}曲线 · ${i * 25}%`, `兼容旧锚点：输入亮度 ${i * 25}% 的输出亮度；默认 ${i * 25}%；单调三次样条。curve_${channel}_points 非空时由自由点覆盖。`, i * 25)))
export const LUMETRI_WHEEL_REGIONS = ['shadow', 'midtone', 'highlight'] as const
export const LUMETRI_WHEEL_PARAMS: readonly VideoEditBuiltinParam[] = LUMETRI_WHEEL_REGIONS.flatMap((region, i) => [hue(`${region}_hue`, `${['阴影', '中间调', '高光'][i]}色相`), positive(`${region}_strength`, `${['阴影', '中间调', '高光'][i]}染色`, '色轮离中心越远染色越强；0 不染色。'), signed(`${region}_luminance`, `${['阴影', '中间调', '高光'][i]}亮度`, '正值提亮这个明暗范围，负值压暗；0 不变。')])
export const LUMETRI_VIGNETTE_PARAMS: readonly VideoEditBuiltinParam[] = [signed('vignette_amount', '晕影数量', '负值压暗四周，正值提亮；0 不变。'), positive('vignette_midpoint', '晕影中点', '越大，中心不受影响的范围越大。', 50), positive('vignette_roundness', '晕影圆度', '0 跟随画面比例，100 为圆形。'), positive('vignette_feather', '晕影羽化', '越大，边缘过渡越柔和。', 50)]
export const VIDEO_EDIT_LUMETRI: VideoEditBuiltinEffectDefinition = { id: 'lumetri_color', name: 'Lumetri 颜色', group: 'color', tooltip: '白平衡、明暗、LUT、曲线、色轮与晕影集中调色', description: '输入LUT→基本校正→Look/创意→RGB/色相曲线→色轮→晕影；默认中性。analyze_video_edit_lumetri多帧自动校色或匹配参考后，经video_edit.effect.parameters通用写入。curve_*_points为控制点JSON数组；旧五点数值及关键帧仍兼容。LUT只传项目引用及强度。', params: [...LUMETRI_BASIC_PARAMS, ...LUMETRI_CREATIVE_PARAMS, ...LUMETRI_CURVE_PARAMS, ...LUMETRI_POINT_PARAMS, ...LUMETRI_LUT_PARAMS, ...LUMETRI_WHEEL_PARAMS, ...LUMETRI_VIGNETTE_PARAMS] }

/** Linear-light gains shared by the shader planner and gray-world inversion. */
export function lumetriWhiteBalance(temperature: number, tint: number): [number, number, number] {
  const gains = [1 + .003 * temperature, 1 - .0025 * tint, 1 - .003 * temperature]
  const luma = gains[0] * .2126 + gains[1] * .7152 + gains[2] * .0722
  return gains.map(value => value / luma) as [number, number, number]
}
export const lumetriLinear = (x: number): number => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4
export const lumetriSrgb = (x: number): number => x <= .0031308 ? x * 12.92 : 1.055 * Math.max(0, x) ** (1 / 2.4) - .055
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))
/** Bounded (256²) histogram statistics: OpenCV GrayworldWB saturation rejection + robust percentile stretch.
 * Pixels are straight, encoded RGB(A), scale=255 for ImageData, scale=1 for float fixtures. */
export function suggestLumetriAutoColor(pixels: ArrayLike<number>, scale = 255): VideoEditBuiltinParams {
  if (pixels.length % 4 || !pixels.length || !(scale > 0)) throw new Error('自动校色需要有效的 RGBA 画面。')
  const means = [0, 0, 0]; let count = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]].map(x => clamp(x / scale, 0, 1))
    const max = Math.max(...rgb); const min = Math.min(...rgb)
    if (pixels[i + 3] / scale < .5 || max < .02 || max > .98 || (max - min) / max > .85) continue
    rgb.forEach((x, c) => { means[c] += lumetriLinear(x) }); count++
  }
  if (count < 8 || means.some(x => x <= 1e-8)) throw new Error('画面缺少可分析的中性明暗区域，请换一帧或手动校色。')
  const rb = means[2] / means[0]
  const temperature = clamp((rb - 1) / (.003 * (rb + 1)), -100, 100)
  const redGain = 1 + .003 * temperature
  const tint = clamp((1 - means[0] * redGain / means[1]) / .0025, -100, 100)
  const gains = lumetriWhiteBalance(temperature, tint); const histogram = new Uint32Array(1024); let samples = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] / scale < .5) continue
    const rgb = [0, 1, 2].map(c => lumetriSrgb(lumetriLinear(clamp(pixels[i + c] / scale, 0, 1)) * gains[c]))
    const y = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
    histogram[Math.round(clamp(y, 0, 1) * 1023)]++; samples++
  }
  const quantile = (q: number): number => { let n = 0; for (let i = 0; i < histogram.length; i++) { n += histogram[i]; if (n >= Math.max(1, samples * q)) return i / 1023 } return 1 }
  const low = quantile(.02); const high = quantile(.98)
  if (high - low < .04) return { temperature, tint, exposure: 0, contrast: 0 }
  const mid = (high + low) / 2
  const exposure = clamp(Math.log2(lumetriLinear(.5) / Math.max(1e-6, lumetriLinear(mid))), -2, 2)
  const gain = 2 ** exposure
  const a = lumetriSrgb(lumetriLinear(low) * gain); const b = lumetriSrgb(lumetriLinear(high) * gain)
  const slope = clamp(.9 / Math.max(.04, b - a), .5, 2)
  return { temperature, tint, exposure, contrast: slope >= 1 ? (slope - 1) * 50 : (slope - 1) * 100 }
}
