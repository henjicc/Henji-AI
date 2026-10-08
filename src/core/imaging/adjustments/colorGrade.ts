import type { ImagingParam, ImagingParams } from '../parameterDefinition'

const signed = (key: string, name: string, description: string): ImagingParam => ({ key, name, type: 'number', unit: 'strength', min: -100, max: 100, step: 1, default: 0, tooltip: description, description })
const positive = (key: string, name: string, description: string, fallback = 0): ImagingParam => ({ key, name, type: 'number', unit: 'strength', min: 0, max: 100, step: 1, default: fallback, tooltip: description, description })
const hue = (key: string, name: string): ImagingParam => ({ key, name, type: 'number', unit: 'degrees', min: 0, max: 360, step: 1, default: 0, tooltip: '0° 红、60° 黄、120° 绿、180° 青、240° 蓝、300° 洋红；强度为 0 时不染色', description: '染色色相角：0 红、60 黄、120 绿、180 青、240 蓝、300 洋红；与对应 strength 一起写入。' })

export const COLOR_GRADE_BASIC_PARAMS: readonly ImagingParam[] = [
  signed('temperature', '色温', '正值偏暖，负值偏冷；0 不变，常用 ±20。'), signed('tint', '色调', '正值偏洋红，负值偏绿；0 不变。'),
  { key: 'exposure', name: '曝光', type: 'number', unit: 'stops', min: -4, max: 4, step: 0.1, default: 0, tooltip: '每增加 1 档，线性光亮度翻倍', description: '线性曝光档：0 不变，+1 翻倍，-1 减半；常用 ±1。' },
  signed('contrast', '对比度', '正值增强明暗反差，负值减弱；0 不变。'), signed('highlights', '高光', '正值提亮亮部，负值恢复高光；0 不变。'), signed('shadows', '阴影', '正值提亮暗部，负值压暗；0 不变。'), signed('whites', '白色', '调整最亮区域；正值更亮，负值压低白点。'), signed('blacks', '黑色', '调整最暗区域；正值抬黑，负值加深黑色。'), signed('saturation', '饱和度', '-100 黑白，0 不变，+100 饱和度翻倍。'), signed('vibrance', '自然饱和度', '优先调整低饱和颜色，减少对鲜艳颜色的影响；0 不变。'),
]
export const COLOR_GRADE_CREATIVE_PARAMS: readonly ImagingParam[] = [positive('faded_film', '淡化胶片', '抬起黑色并压缩反差；0 不变。'), positive('sharpen', '锐化', '增强边缘细节；0 不变，20 轻微提清晰度。'), hue('creative_shadow_hue', '阴影色相'), positive('creative_shadow_strength', '阴影染色', '阴影色调分离强度；0 不染色。'), hue('creative_highlight_hue', '高光色相'), positive('creative_highlight_strength', '高光染色', '高光色调分离强度；0 不染色。')]
export const COLOR_GRADE_CURVE_CHANNELS = ['master', 'red', 'green', 'blue'] as const
export const COLOR_GRADE_HUE_CURVES = ['hue_sat', 'hue_hue', 'hue_luma', 'luma_sat', 'sat_sat'] as const
export const COLOR_GRADE_HUE_CURVE_NAMES = ['色相与饱和度', '色相与色相', '色相与亮度', '亮度与饱和度', '饱和度与饱和度'] as const
export const COLOR_GRADE_POINT_PARAMS: readonly ImagingParam[] = [...COLOR_GRADE_CURVE_CHANNELS, ...COLOR_GRADE_HUE_CURVES].map((channel, i) => ({ key: `curve_${channel}_points`, name: i < 4 ? `${['RGB 主', '红', '绿', '蓝'][i]}控制点` : COLOR_GRADE_HUE_CURVE_NAMES[i - 4], type: 'curve', default: '', tooltip: '单击加点，横纵拖动；右键或拖出删除。', description: `至少2个{x,y}控制点的JSON数组（编码不超过4096字符），x/y为0–100百分比，x严格递增。${i < 4 ? 'y为输出亮度，空字符串沿用旧curve_' + channel + '_0至_4五点（及其关键帧）。' : 'y=50不变，0/100为最大减弱/增强；色相横轴0红、33绿、67蓝、100红，两端y必须相等。'} 新曲线整体关键帧仅支持hold；旧五点数值动画保持原插值。` }))
export const COLOR_GRADE_LUT_PARAMS: readonly ImagingParam[] = [
  ...['input', 'look'].flatMap(stage => [{ key: `${stage}_lut`, name: stage === 'input' ? '输入 LUT' : '创意 Look', type: 'lut' as const, default: '', tooltip: '选择已导入的 .cube 文件', description: '引用video_edit.document.color_luts中的id，禁止文件路径；空字符串关闭。' }, positive(`${stage}_lut_strength`, stage === 'input' ? '输入 LUT 强度' : 'Look 强度', '0保持原色，100完全应用LUT。', 100)]),
]
export const COLOR_GRADE_CURVE_PARAMS: readonly ImagingParam[] = COLOR_GRADE_CURVE_CHANNELS.flatMap((channel, c) => Array.from({ length: 5 }, (_, i) => positive(`curve_${channel}_${i}`, `${['RGB 主', '红', '绿', '蓝'][c]}曲线 · ${i * 25}%`, `兼容旧锚点：输入亮度 ${i * 25}% 的输出亮度；默认 ${i * 25}%；单调三次样条。curve_${channel}_points 非空时由自由点覆盖。`, i * 25)))
export const COLOR_GRADE_WHEEL_REGIONS = ['shadow', 'midtone', 'highlight'] as const
export const COLOR_GRADE_WHEEL_PARAMS: readonly ImagingParam[] = COLOR_GRADE_WHEEL_REGIONS.flatMap((region, i) => [hue(`${region}_hue`, `${['阴影', '中间调', '高光'][i]}色相`), positive(`${region}_strength`, `${['阴影', '中间调', '高光'][i]}染色`, '色轮离中心越远染色越强；0 不染色。'), signed(`${region}_luminance`, `${['阴影', '中间调', '高光'][i]}亮度`, '正值提亮这个明暗范围，负值压暗；0 不变。')])
export const COLOR_GRADE_HSL_CORRECTION_KEYS = ['hsl_temperature', 'hsl_tint', 'hsl_contrast', 'hsl_sharpen', 'hsl_saturation', 'hsl_grade_strength', 'hsl_grade_luminance'] as const
const keyRange = (channel: string, name: string, max: number): ImagingParam[] => [
  ...['start', 'end'].map((edge, i): ImagingParam => ({ key: `hsl_${channel}_${edge}`, name: `${name}${i ? '终点' : '起点'}`, type: 'number', unit: channel === 'hue' ? 'degrees' : 'percent', min: 0, max, step: 1, default: i ? max : 0,
    tooltip: channel === 'hue' ? '顺时针颜色范围；起点大于终点时跨过红色 0°，0–360° 为全部色相' : '选中此百分比范围；起点须小于等于终点',
    description: channel === 'hue' ? 'HSL 色相角顺时针选区；start>end 跨 0° 回绕，0/360 为全部。肤色常用15–50°，天空190–250°，红340–20°，需按画面微调。' : `HSL ${name}百分比，0–100；start<=end，默认全选。` })),
  { key: `hsl_${channel}_feather`, name: `${name}柔和度`, type: 'number', unit: 'percent', min: 0, max: 100, step: 1, default: 0, tooltip: `在${name}选区两端向外平滑过渡；0 为硬边界`, description: `键控${name}外侧羽化；0硬边，100相当于${channel === 'hue' ? '180°' : '整个归一化范围'}的过渡宽度，常用5–20。` },
]
export const COLOR_GRADE_HSL_PARAMS: readonly ImagingParam[] = [
  ...keyRange('hue', '色相', 360), ...keyRange('saturation', '饱和度', 100), ...keyRange('luminance', '亮度', 100),
  { key: 'hsl_invert', name: '反向', type: 'boolean', default: false, tooltip: '校正选中颜色之外的区域', description: '反转联合 HSL 键控蒙版，true 校正选区外，false 校正选区内。' },
  { key: 'hsl_show_mask', name: '显示蒙版', type: 'boolean', default: false, animatable: false, tooltip: '节目画面显示灰度选区：白色选中、黑色未选中；关闭后恢复调色画面', description: '以灰度显示当前 HSL 选区，供用户及助手观察确认；检查完成写false恢复。此开关不设关键帧，开启时导出同样显示蒙版。' },
  positive('hsl_denoise', '键控去噪', '平滑细碎的键控噪点；0关闭，100的高斯标准差为画面高度的0.5%。'),
  positive('hsl_blur', '键控模糊', '柔化选区边缘；0关闭，100的高斯标准差为画面高度的2%。'),
  signed('hsl_temperature', '选区色温', '选区内正值偏暖、负值偏冷；0不变，常用±20。'), signed('hsl_tint', '选区色调', '选区内正值偏洋红、负值偏绿；0不变。'),
  signed('hsl_contrast', '选区对比度', '选区内增强或减弱明暗反差；0不变，在线性光中调整。'), positive('hsl_sharpen', '选区锐化', '只增强选区内细节；0不变，20轻微增强，半径相对画面高度。'),
  signed('hsl_saturation', '选区饱和度', '只调整选区饱和度；-100黑白，0不变，100翻倍，在线性光中调整。'),
  hue('hsl_grade_hue', '选区色轮色相'), positive('hsl_grade_strength', '选区色轮强度', '选区内的中间调染色强度，0不染色；色相角单独改变不会启用校正。'), signed('hsl_grade_luminance', '选区色轮亮度', '只调整选区内中间调亮度，0不变。'),
]
export const COLOR_GRADE_VIGNETTE_PARAMS: readonly ImagingParam[] = [signed('vignette_amount', '晕影数量', '负值压暗四周，正值提亮；0 不变。'), positive('vignette_midpoint', '晕影中点', '越大，中心不受影响的范围越大。', 50), positive('vignette_roundness', '晕影圆度', '0 跟随画面比例，100 为圆形。'), positive('vignette_feather', '晕影羽化', '越大，边缘过渡越柔和。', 50)]


/** Linear-light gains shared by the shader planner and gray-world inversion. */
export function colorGradeWhiteBalance(temperature: number, tint: number): [number, number, number] {
  const gains = [1 + .003 * temperature, 1 - .0025 * tint, 1 - .003 * temperature]
  const luma = gains[0] * .2126 + gains[1] * .7152 + gains[2] * .0722
  return gains.map(value => value / luma) as [number, number, number]
}
export const colorGradeLinear = (x: number): number => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4
export const colorGradeSrgb = (x: number): number => x <= .0031308 ? x * 12.92 : 1.055 * Math.max(0, x) ** (1 / 2.4) - .055
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))
/** Bounded (256²) histogram statistics: OpenCV GrayworldWB saturation rejection + robust percentile stretch.
 * Pixels are straight, encoded RGB(A), scale=255 for ImageData, scale=1 for float fixtures. */
export function suggestColorGradeAutoColor(pixels: ArrayLike<number>, scale = 255): ImagingParams {
  if (pixels.length % 4 || !pixels.length || !(scale > 0)) throw new Error('自动校色需要有效的 RGBA 画面。')
  const means = [0, 0, 0]; let count = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]].map(x => clamp(x / scale, 0, 1))
    const max = Math.max(...rgb); const min = Math.min(...rgb)
    if (pixels[i + 3] / scale < .5 || max < .02 || max > .98 || (max - min) / max > .85) continue
    rgb.forEach((x, c) => { means[c] += colorGradeLinear(x) }); count++
  }
  if (count < 8 || means.some(x => x <= 1e-8)) throw new Error('画面缺少可分析的中性明暗区域，请换一帧或手动校色。')
  const rb = means[2] / means[0]
  const temperature = clamp((rb - 1) / (.003 * (rb + 1)), -100, 100)
  const redGain = 1 + .003 * temperature
  const tint = clamp((1 - means[0] * redGain / means[1]) / .0025, -100, 100)
  const gains = colorGradeWhiteBalance(temperature, tint); const histogram = new Uint32Array(1024); let samples = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] / scale < .5) continue
    const rgb = [0, 1, 2].map(c => colorGradeSrgb(colorGradeLinear(clamp(pixels[i + c] / scale, 0, 1)) * gains[c]))
    const y = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
    histogram[Math.round(clamp(y, 0, 1) * 1023)]++; samples++
  }
  const quantile = (q: number): number => { let n = 0; for (let i = 0; i < histogram.length; i++) { n += histogram[i]; if (n >= Math.max(1, samples * q)) return i / 1023 } return 1 }
  const low = quantile(.02); const high = quantile(.98)
  if (high - low < .04) return { temperature, tint, exposure: 0, contrast: 0 }
  const mid = (high + low) / 2
  const exposure = clamp(Math.log2(colorGradeLinear(.5) / Math.max(1e-6, colorGradeLinear(mid))), -2, 2)
  const gain = 2 ** exposure
  const a = colorGradeSrgb(colorGradeLinear(low) * gain); const b = colorGradeSrgb(colorGradeLinear(high) * gain)
  const slope = clamp(.9 / Math.max(.04, b - a), .5, 2)
  return { temperature, tint, exposure, contrast: slope >= 1 ? (slope - 1) * 50 : (slope - 1) * 100 }
}
