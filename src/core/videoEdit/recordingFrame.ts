import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import { RECORDING_FRAME_BACKGROUND_HEX, RECORDING_FRAME_SOLID_DEFAULT_HEX } from '../theme/colorTokens'

/**
 * 录屏画框（参照 Recordly 的背景与画框）：片段画面按边距缩小居中、圆角、柔和投影，四周铺背景，输出尺寸不变。
 * 内容取片段在画面中的实际范围（位置、缩放后的外接矩形），所以放在嵌套序列片段或屏幕片段上都对准真实内容。
 * 背景预设是画面内容色（登记在 colorTokens），不随应用主题变化。
 */
export const RECORDING_FRAME_EFFECT = 'recording_frame'
export const RECORDING_FRAME_BACKGROUNDS = ['graphite', 'mist', 'ocean', 'sunset', 'solid'] as const
export type RecordingFrameBackground = typeof RECORDING_FRAME_BACKGROUNDS[number]

export const RECORDING_FRAME_DEFINITION: VideoEditBuiltinEffectDefinition = {
  id: RECORDING_FRAME_EFFECT, name: '录屏画框', group: 'frame',
  tooltip: '缩小画面并加圆角、投影和背景，让录屏更精致',
  description: '把片段画面按边距缩小居中，加圆角与柔和投影，四周铺渐变或纯色背景（不透明），常用于录屏成片。边距、圆角按画面高度比例，与分辨率无关；画面里其他效果（光标、自动缩放）放在它之前，会在画框内生效。',
  params: [
    { key: 'background', name: '背景', type: 'enum', default: 'graphite', options: [{ value: 'graphite', label: '石墨' }, { value: 'mist', label: '晨雾' }, { value: 'ocean', label: '海蓝' }, { value: 'sunset', label: '暖阳' }, { value: 'solid', label: '纯色' }], tooltip: '画框四周的背景', description: 'graphite 深灰渐变（默认，适合深色界面）；mist 浅灰蓝渐变（适合浅色界面）；ocean 蓝色渐变；sunset 橙粉渐变；solid 使用“背景颜色”的纯色。' },
    { key: 'color', name: '背景颜色', type: 'color', default: RECORDING_FRAME_SOLID_DEFAULT_HEX, tooltip: '背景选“纯色”时使用的颜色', description: '仅 background=solid 时生效，写 #rrggbb。' },
    { key: 'padding', name: '边距', type: 'number', unit: 'percent', min: 0, max: 25, step: 0.5, default: 6, tooltip: '画面四周留出的背景宽度（占画面高度）', description: '每侧边距占画面高度的百分比：0 画面铺满（只有圆角），6 默认，15 以上画面明显缩小。' },
    { key: 'radius', name: '圆角', type: 'number', unit: 'percent', min: 0, max: 20, step: 0.5, default: 2.5, tooltip: '画面四角的圆角大小（占画面高度）', description: '圆角半径占画面高度的百分比：0 直角，2.5 默认，10 以上很圆。' },
    { key: 'shadow', name: '投影', type: 'number', unit: 'strength', min: 0, max: 100, step: 1, default: 50, tooltip: '画面下方投影的浓淡与范围', description: '0 无投影；50 默认柔和投影；100 浓重且扩散更大的投影。' },
  ],
}
/** 背景渐变两端颜色（0–1 的 sRGB）；纯色时两端相同。 */
export function recordingFrameBackground(params: VideoEditBuiltinParams): [[number, number, number], [number, number, number]] {
  const parse = (hex: string): [number, number, number] => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]
  const background = String(params.background) as RecordingFrameBackground
  if (background === 'solid') { const color = parse(/^#[0-9a-f]{6}$/i.test(String(params.color)) ? String(params.color) : RECORDING_FRAME_SOLID_DEFAULT_HEX); return [color, color] }
  const [from, to] = RECORDING_FRAME_BACKGROUND_HEX[background in RECORDING_FRAME_BACKGROUND_HEX ? background as keyof typeof RECORDING_FRAME_BACKGROUND_HEX : 'graphite']
  return [parse(from), parse(to)]
}
