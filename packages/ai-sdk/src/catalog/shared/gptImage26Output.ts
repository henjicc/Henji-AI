// GPT Image 2.6 的动图（GIF）与矢量（SVG）输出，供 APIMart、Fal、KIE 共用。
// 字段与限制来源：docs/model-adaptation/GPT-Image-2.6/ 下各供应商文档（2026-11-09 读取）。
import type { JsonValue } from '../../types/runtime'
import { GPT25_OUTPUT_REFERENCE } from './gptImage25Pricing'

export const GPT26_OUTPUTS = ['image', 'gif', 'svg'] as const
export type Gpt26Output = (typeof GPT26_OUTPUTS)[number]
export const GPT26_FRAME_COUNT = { default: 9, min: 2, max: 16 } as const
/** Fal 单帧不低于 655,360 像素、所有帧共用 8,294,400 像素，任何比例最多 12 帧。 */
export const GPT26_FAL_FRAME_COUNT = { default: 9, min: 2, max: 12 } as const
export const GPT26_FRAME_DURATION = { default: 200, min: 20, max: 2000, step: 10 } as const

/** 各家文档给出的矢量化模型；APIMart 只给示例，没有完整列表。 */
export const GPT26_SVG_MODELS = {
  apimart: { values: ['gpt-5.4-mini', 'gpt-5.6-sol'], default: 'gpt-5.4-mini' },
  fal: { values: ['gpt-6-astra', 'gpt-5.5', 'gpt-5.4', 'gpt-5.6-terra', 'gpt-6-luna'], default: 'gpt-6-astra' },
  kie: { values: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-sol'], default: 'gpt-5.6-luna' },
} as const

export function gpt26Output(value: JsonValue): Gpt26Output {
  if (value === undefined) return 'image'
  if (typeof value !== 'string' || !(GPT26_OUTPUTS as readonly string[]).includes(value)) throw new Error(`GPT Image 2.6 输出类型不支持：${String(value)}`)
  return value as Gpt26Output
}

function integerIn(value: JsonValue, range: { default: number; min: number; max: number }, label: string): number {
  if (value === undefined) return range.default
  if (typeof value !== 'number' || !Number.isInteger(value) || value < range.min || value > range.max) {
    throw new Error(`GPT Image 2.6 ${label}必须为 ${range.min}–${range.max} 的整数`)
  }
  return value
}

export const gpt26FrameCount = (value: JsonValue, range: { default: number; min: number; max: number } = GPT26_FRAME_COUNT) => integerIn(value, range, '动图帧数')

/** 供应商按 10 ms 取整，这里先取整，估价与实际一致。 */
export function gpt26FrameDuration(value: JsonValue): number {
  return Math.round(integerIn(value, GPT26_FRAME_DURATION, '每帧时长') / 10) * 10
}

export function gpt26SvgModel(provider: keyof typeof GPT26_SVG_MODELS, value: JsonValue): string {
  const { values, default: fallback } = GPT26_SVG_MODELS[provider]
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) throw new Error(`GPT Image 2.6 矢量化模型不支持：${String(value)}`)
  return value
}

const ratioValue = (ratio: string) => { const [w, h] = ratio.split(':').map(Number); return w / h }
const snap = (value: number, round: (n: number) => number) => Math.max(16, round(value / 16) * 16)

/**
 * APIMart 与 KIE 把所有帧拼成一张图再生成：2–8 帧 4×2、9 帧 3×3、10–12 帧 4×3、13–16 帧 4×4；
 * 拼图每边 ≤ 3840、总像素 ≤ 8,294,400、宽高比 ≤ 3:1。单帧按 512×512 的面积按比例换算，
 * 最大的 4×4 拼图也不超过边长与像素上限，只有宽高比可能超限。
 */
const SHEET_MAX_PIXELS = 8_294_400
function sheetGrid(frames: number): [number, number] {
  if (frames <= 8) return [4, 2]
  if (frames === 9) return [3, 3]
  if (frames <= 12) return [4, 3]
  return [4, 4]
}

export interface Gpt26GifFrame { width: number; height: number; sheetPixels: number }

function sheetFrameSize(ratio: string): [number, number] {
  const r = ratioValue(ratio)
  return [snap(512 * Math.sqrt(r), Math.floor), snap(512 / Math.sqrt(r), Math.floor)]
}

/** 按取整到 16 倍数后的实际单帧尺寸判断：3:1 单帧取整后拼成 3×3 会略超 3:1。 */
function sheetRatioFits(ratio: string, frames: number): boolean {
  const [cols, rows] = sheetGrid(frames)
  const [width, height] = sheetFrameSize(ratio)
  const sheetRatio = (cols * width) / (rows * height)
  return sheetRatio <= 3 && sheetRatio >= 1 / 3
}

/** 智能比例在动图下只能从当前帧数拼得出来的比例里挑。 */
export function gpt26SheetRatios(candidates: readonly string[], frames: number): string[] {
  return candidates.filter(ratio => sheetRatioFits(ratio, frames))
}

export function gpt26SheetFrame(ratio: string, frames: number): Gpt26GifFrame {
  if (!sheetRatioFits(ratio, frames)) throw new Error(`${frames} 帧动图拼图后宽高比超过 3:1，请换一个比例或帧数`)
  const [cols, rows] = sheetGrid(frames)
  const [width, height] = sheetFrameSize(ratio)
  return { width, height, sheetPixels: width * height * cols * rows }
}

/**
 * Fal 的 image_size 是单帧尺寸，单帧总像素须 ≥ 655,360，所有帧共用 8,294,400 像素预算。
 * 单帧取恰好不低于下限的尺寸，帧数超出预算时报错并给出当前比例下的最多帧数。
 */
const FAL_MIN_PIXELS = 655_360
export function gpt26FalFrame(ratio: string, frames: number): Gpt26GifFrame {
  const r = ratioValue(ratio)
  let width = snap(Math.sqrt(FAL_MIN_PIXELS * r), Math.ceil)
  let height = snap(Math.sqrt(FAL_MIN_PIXELS / r), Math.round)
  while (width * height < FAL_MIN_PIXELS) { if (width / height < r) width += 16; else height += 16 }
  const maxFrames = Math.floor(SHEET_MAX_PIXELS / (width * height))
  if (frames > maxFrames) throw new Error(`当前比例下 Fal 动图最多 ${maxFrames} 帧`)
  return { width, height, sheetPixels: width * height * frames }
}

/** 动图按整张拼图计费：以 1:1 1K 的输出 token 为基准按像素折算，质量档位顺序同 2.5 参考表。 */
export function gpt26GifOutputTokens(sheetPixels: number, qualityIndex: number): number {
  const base = GPT25_OUTPUT_REFERENCE['1:1']
  return base.tokens[qualityIndex] * sheetPixels / (base.width * base.height)
}

/** 带参考图的动图：供应商按每张参考图 1536 个图片输入 token 预扣。 */
export const GPT26_GIF_INPUT_TOKENS_PER_IMAGE = 1536

/** SVG 各家都只支持文生图；动图能否带参考图看端点。 */
export function assertGpt26Output(output: Gpt26Output, hasImages: boolean, gifWithImages: boolean): void {
  if (!hasImages || output === 'image' || (output === 'gif' && gifWithImages)) return
  throw new Error(output === 'svg' ? 'GPT Image 2.6 矢量图只支持文生图，请移除参考图' : '当前版本的动图只支持文生图，请移除参考图')
}
