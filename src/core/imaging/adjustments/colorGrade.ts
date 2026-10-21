import type { ImagingParam } from '../parameterDefinition'

const signed = (key: string, name: string, description: string): ImagingParam => ({ key, name, type: 'number', unit: 'strength', min: -100, max: 100, step: 1, default: 0, tooltip: description, description })
const positive = (key: string, name: string, description: string, fallback = 0): ImagingParam => ({ key, name, type: 'number', unit: 'strength', min: 0, max: 100, step: 1, default: fallback, tooltip: description, description })
const hue = (key: string, name: string): ImagingParam => ({ key, name, type: 'number', unit: 'degrees', min: 0, max: 360, step: 1, default: 0, tooltip: '0° 红、60° 黄、120° 绿、180° 青、240° 蓝、300° 洋红；强度为 0 时不染色', description: '染色色相角：0 红、60 黄、120 绿、180 青、240 蓝、300 洋红；与对应 strength 一起写入。' })

export const COLOR_GRADE_BASIC_PARAMS: readonly ImagingParam[] = [
  { key: 'temperature_kelvin', name: '色温', type: 'number', unit: 'kelvin', min: 2000, max: 20000, step: 50, default: 6500, tooltip: '填写拍摄时的光源色温来还原白色；低于 6500 K 画面变冷，高于则变暖', description: '白平衡校正（开尔文）：写入画面光源的色温即可让白色物体还原中性。6500 不变；数值越低画面越冷（校正钨丝灯 3200 K 的暖光写 3200），越高越暖（阴天/阴影 7500–9000）。常用 2800–10000。先调白平衡与曝光，再调反差和色彩。' },
  signed('tint', '色调', '正值偏洋红，负值偏绿；0 不变。用于校正荧光灯偏绿等绿-洋红偏色，常用 ±20。'),
  { key: 'exposure', name: '曝光', type: 'number', unit: 'stops', min: -4, max: 4, step: 0.05, default: 0, tooltip: '每增加 1 档，线性光亮度翻倍', description: '线性曝光（EV 档）：0 不变，+1 亮度翻倍，-1 减半；常用 ±1.5。中灰偏暗/偏亮先用它校正，再用高光/阴影/白色/黑色收尾。' },
  signed('contrast', '对比度', '围绕 18% 中灰改变明暗反差，只作用于亮度、不改色相；正值增强，负值减弱。+100 斜率 3 倍，-100 完全压平；常用 ±30。'),
  signed('highlights', '高光', '调整亮部（中灰以上）；负值恢复高光细节，正值提亮。常用 ±40。'), signed('shadows', '阴影', '调整暗部（中灰以下）；正值提亮暗部细节，负值压暗。常用 ±40。'),
  signed('whites', '白色', '调整最亮端（白点）；高光溢出时用负值压回，画面发灰时用正值拉开。'), signed('blacks', '黑色', '调整最暗端（黑点）；正值抬起黑色，负值加深黑色。'),
  signed('saturation', '饱和度', '均匀改变所有颜色的彩度（OkLCh，色相不变）；-100 黑白，0 不变，+100 彩度翻倍。'),
  signed('vibrance', '自然饱和度', '优先提升低饱和颜色并保护肤色，比饱和度更自然；负值优先降低低饱和颜色。常用 +10–30。'),
]
export const COLOR_GRADE_TONE_PARAMS: readonly ImagingParam[] = [
  signed('tone_highlights', '曲线高光', '参数曲线：亮度 75–100% 区间整体提亮或压暗，端点不动。'), signed('tone_lights', '曲线亮部', '参数曲线：亮度 50–75% 区间整体提亮或压暗。'),
  signed('tone_darks', '曲线暗部', '参数曲线：亮度 25–50% 区间整体提亮或压暗。'), signed('tone_shadows', '曲线阴影', '参数曲线：亮度 0–25% 区间整体提亮或压暗，端点不动。'),
]
export const COLOR_GRADE_CREATIVE_PARAMS: readonly ImagingParam[] = [positive('faded_film', '淡化胶片', '抬起黑色并压缩反差；0 不变。'), positive('sharpen', '锐化', '增强边缘细节；0 不变，20 轻微提清晰度。')]
export const COLOR_GRADE_CURVE_CHANNELS = ['master', 'red', 'green', 'blue'] as const
export const COLOR_GRADE_HUE_CURVES = ['hue_sat', 'hue_hue', 'hue_luma', 'luma_sat', 'sat_sat'] as const
export const COLOR_GRADE_HUE_CURVE_NAMES = ['色相与饱和度', '色相与色相', '色相与亮度', '亮度与饱和度', '饱和度与饱和度'] as const
export const COLOR_GRADE_POINT_PARAMS: readonly ImagingParam[] = [...COLOR_GRADE_CURVE_CHANNELS, ...COLOR_GRADE_HUE_CURVES].map((channel, i) => ({ key: `curve_${channel}_points`, name: i < 4 ? `${['RGB 主', '红', '绿', '蓝'][i]}控制点` : COLOR_GRADE_HUE_CURVE_NAMES[i - 4], type: 'curve', default: '', tooltip: '单击曲线加点，拖动调整；双击、Ctrl+单击或拖出图外删除点。', description: `至少2个{x,y}控制点的JSON数组（编码不超过4096字符），x/y为0–100百分比，x严格递增。${i < 4 ? 'y为输出亮度，空字符串沿用旧curve_' + channel + '_0至_4五点（及其关键帧）。' : 'y=50不变，0/100为最大减弱/增强；色相横轴0红、17黄、33绿、50青、67蓝、83洋红、100红（按感知色相测量），两端y必须相等。'} 新曲线整体关键帧仅支持hold；旧五点数值动画保持原插值。` }))
export const COLOR_GRADE_LUT_PARAMS: readonly ImagingParam[] = [
  ...['input', 'look'].flatMap(stage => [{ key: `${stage}_lut`, name: stage === 'input' ? '输入 LUT' : '创意 Look', type: 'lut' as const, default: '', tooltip: '选择已导入的 .cube 文件', description: '引用video_edit.document.color_luts中的id，禁止文件路径；空字符串关闭。' }, positive(`${stage}_lut_strength`, stage === 'input' ? '输入 LUT 强度' : 'Look 强度', '0保持原色，100完全应用LUT。', 100)]),
]
export const COLOR_GRADE_CURVE_PARAMS: readonly ImagingParam[] = COLOR_GRADE_CURVE_CHANNELS.flatMap((channel, c) => Array.from({ length: 5 }, (_, i) => positive(`curve_${channel}_${i}`, `${['RGB 主', '红', '绿', '蓝'][c]}曲线 · ${i * 25}%`, `兼容旧锚点：输入亮度 ${i * 25}% 的输出亮度；默认 ${i * 25}%；单调三次样条。curve_${channel}_points 非空时由自由点覆盖。`, i * 25)))
export const COLOR_GRADE_WHEEL_REGIONS = ['shadow', 'midtone', 'highlight', 'global'] as const
const WHEEL_NAMES = ['阴影', '中间调', '高光', '全局'] as const
export const COLOR_GRADE_WHEEL_PARAMS: readonly ImagingParam[] = [
  { key: 'wheel_mode', name: '色轮模式', type: 'enum', options: [{ value: 'grading', label: '分级' }, { value: 'primary', label: '一级' }], default: 'grading', animatable: false, tooltip: '分级：按明暗分区染色；一级：Lift/Gamma/Gain/Offset', description: 'grading 为 Lightroom 式色彩分级（阴影/中间调/高光/全局染色与亮度，配合混合与平衡）；primary 为 Lift/Gamma/Gain/Offset 一级校色（阴影轮=Lift、中间调=Gamma、高光=Gain、全局=Offset），适合视频按通道校正。' },
  ...COLOR_GRADE_WHEEL_REGIONS.flatMap((region, i) => [hue(`${region}_hue`, `${WHEEL_NAMES[i]}色相`), positive(`${region}_strength`, `${WHEEL_NAMES[i]}染色`, '色轮离中心越远染色越强；0 不染色，常用 5–25。'), signed(`${region}_luminance`, `${WHEEL_NAMES[i]}亮度`, '正值提亮这个明暗范围，负值压暗；0 不变。')]),
  positive('grade_blending', '分级混合', '分级模式下阴影、中间调、高光三区的重叠程度；50 为默认过渡，越大越柔和。', 50),
  signed('grade_balance', '分级平衡', '分级模式下阴影与高光的分界；正值让高光区扩大，负值让阴影区扩大。'),
]
export const COLOR_GRADE_MIXER_COLORS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const
export const COLOR_GRADE_MIXER_COLOR_NAMES = ['红色', '橙色', '黄色', '绿色', '浅绿', '蓝色', '紫色', '洋红'] as const
/** Display-hue centres of the eight named colors (Lightroom HSL / Color Mixer). */
export const COLOR_GRADE_MIXER_CENTERS = [0, 30, 60, 120, 180, 240, 270, 300] as const
export const COLOR_GRADE_MIXER_PARAMS: readonly ImagingParam[] = COLOR_GRADE_MIXER_COLORS.flatMap((color, i) => [
  signed(`mixer_${color}_hue`, `${COLOR_GRADE_MIXER_COLOR_NAMES[i]}色相`, `把${COLOR_GRADE_MIXER_COLOR_NAMES[i]}推向相邻颜色；±100 约偏移 30°。`),
  signed(`mixer_${color}_saturation`, `${COLOR_GRADE_MIXER_COLOR_NAMES[i]}饱和度`, `只改变${COLOR_GRADE_MIXER_COLOR_NAMES[i]}的彩度；-100 去色，+100 翻倍。`),
  signed(`mixer_${color}_luminance`, `${COLOR_GRADE_MIXER_COLOR_NAMES[i]}明亮度`, `只改变${COLOR_GRADE_MIXER_COLOR_NAMES[i]}的明暗，不影响灰色。`),
])
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

/** Every persisted color grade parameter in panel order; video effect definition and image schema both derive from it. */
export const COLOR_GRADE_PARAMS: readonly ImagingParam[] = [...COLOR_GRADE_BASIC_PARAMS, ...COLOR_GRADE_TONE_PARAMS, ...COLOR_GRADE_CREATIVE_PARAMS, ...COLOR_GRADE_CURVE_PARAMS, ...COLOR_GRADE_POINT_PARAMS, ...COLOR_GRADE_LUT_PARAMS, ...COLOR_GRADE_WHEEL_PARAMS, ...COLOR_GRADE_MIXER_PARAMS, ...COLOR_GRADE_HSL_PARAMS, ...COLOR_GRADE_VIGNETTE_PARAMS]

/** Relative linear-light gains of the HSL secondary correction (hsl_temperature / hsl_tint keep this local meaning). */
export function colorGradeWhiteBalance(temperature: number, tint: number): [number, number, number] {
  const gains = [1 + .003 * temperature, 1 - .0025 * tint, 1 - .003 * temperature]
  const luma = gains[0] * .2126 + gains[1] * .7152 + gains[2] * .0722
  return gains.map(value => value / luma) as [number, number, number]
}
export const colorGradeLinear = (x: number): number => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4
export const colorGradeSrgb = (x: number): number => x <= .0031308 ? x * 12.92 : 1.055 * Math.max(0, x) ** (1 / 2.4) - .055
