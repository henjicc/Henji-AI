import { VIDEO_EDIT_SEQUENCE_LIMITS, type VideoEditSequenceSize } from './sequenceSize'

export const VIDEO_EDIT_SEQUENCE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const
export type VideoEditSequenceRatio = typeof VIDEO_EDIT_SEQUENCE_RATIOS[number]
export const VIDEO_EDIT_SEQUENCE_TIERS = [
  { label: '480p', pixels: 854 * 480 }, { label: '720p', pixels: 1280 * 720 },
  { label: '1080p', pixels: 1920 * 1080 }, { label: '2K', pixels: 2560 * 1440 },
  { label: '4K', pixels: 3840 * 2160 }, { label: '8K', pixels: 7680 * 4320 },
] as const
export type VideoEditSequenceTier = typeof VIDEO_EDIT_SEQUENCE_TIERS[number]['label']
export interface VideoEditSequencePreset {
  ratio: VideoEditSequenceRatio | '自定义'
  tier: VideoEditSequenceTier | '自定义'
}

/** 就近取偶数；尺寸换算最小为 16，不截断上限，以便调用方准确判断禁用和错误。 */
export function roundVideoEditSequenceDimension(value: number): number {
  return Math.max(VIDEO_EDIT_SEQUENCE_LIMITS.minDimension, Math.round(value / 2) * 2)
}
export function videoEditSequenceSizeForPixels(pixels: number, aspect: number): VideoEditSequenceSize {
  if (!Number.isFinite(pixels) || pixels <= 0 || !Number.isFinite(aspect) || aspect <= 0) throw new Error('画面比例与总像素必须为正数。')
  const height = Math.sqrt(pixels / aspect)
  const size = { width: roundVideoEditSequenceDimension(height * aspect), height: roundVideoEditSequenceDimension(height) }
  // 8K 档取偶后可能略超总像素上限（如 4:3），此时长边向下取偶，避免整档因舍入被禁用。
  if (pixels <= VIDEO_EDIT_SEQUENCE_LIMITS.maxPixels && size.width * size.height > VIDEO_EDIT_SEQUENCE_LIMITS.maxPixels) {
    if (aspect >= 1) size.width = Math.floor(size.height * aspect / 2) * 2
    else size.height = Math.floor(size.width / aspect / 2) * 2
  }
  return size
}
/**
 * 预设比例 × 档位用行业常用尺寸（按短边定档）：16:9 / 9:16 为标准电视规格，4:3 为 640×480、1440×1080、2880×2160 一系，
 * 21:9 为超宽屏常用的 2560×1080、3440×1440、5120×2160（实际约 2.37:1）；8K 按 4320 短边需宽 10240，超过 GPU 单边 8192 上限，
 * 改取 8K 满宽 7680 的宽银幕裁切 7680×3200（2.4:1，与超宽屏同一观感）。自定义比例才走总像素公式。
 */
const LANDSCAPE: Record<'16:9' | '1:1' | '4:3' | '21:9', Record<VideoEditSequenceTier, readonly [number, number]>> = {
  '16:9': { '480p': [854, 480], '720p': [1280, 720], '1080p': [1920, 1080], '2K': [2560, 1440], '4K': [3840, 2160], '8K': [7680, 4320] },
  '1:1': { '480p': [480, 480], '720p': [720, 720], '1080p': [1080, 1080], '2K': [1440, 1440], '4K': [2160, 2160], '8K': [4320, 4320] },
  '4:3': { '480p': [640, 480], '720p': [960, 720], '1080p': [1440, 1080], '2K': [1920, 1440], '4K': [2880, 2160], '8K': [5760, 4320] },
  '21:9': { '480p': [1120, 480], '720p': [1680, 720], '1080p': [2560, 1080], '2K': [3440, 1440], '4K': [5120, 2160], '8K': [7680, 3200] },
}
const PORTRAIT = { '9:16': '16:9', '3:4': '4:3' } as const
function standardVideoEditSequenceSize(ratio: VideoEditSequenceRatio, tier: VideoEditSequenceTier): VideoEditSequenceSize {
  if (ratio === '9:16' || ratio === '3:4') { const [height, width] = LANDSCAPE[PORTRAIT[ratio]][tier]; return { width, height } }
  const [width, height] = LANDSCAPE[ratio][tier]
  return { width, height }
}
export function videoEditSequenceRatioValue(ratio: VideoEditSequenceRatio): number {
  const [width, height] = ratio.split(':').map(Number)
  return width / height
}
export function videoEditSequenceTierSize(aspect: number, tier: VideoEditSequenceTier): VideoEditSequenceSize {
  const ratio = VIDEO_EDIT_SEQUENCE_RATIOS.find(value => Math.abs(aspect / videoEditSequenceRatioValue(value) - 1) < .005)
  if (ratio) return standardVideoEditSequenceSize(ratio, tier)
  return videoEditSequenceSizeForPixels(VIDEO_EDIT_SEQUENCE_TIERS.find(value => value.label === tier)!.pixels, aspect)
}
export function videoEditSequencePresetSize(ratio: VideoEditSequenceRatio, tier: VideoEditSequenceTier): VideoEditSequenceSize {
  return standardVideoEditSequenceSize(ratio, tier)
}
export function inferVideoEditSequencePreset(size: VideoEditSequenceSize): VideoEditSequencePreset {
  for (const ratio of VIDEO_EDIT_SEQUENCE_RATIOS) for (const { label: tier } of VIDEO_EDIT_SEQUENCE_TIERS) {
    const candidate = videoEditSequencePresetSize(ratio, tier)
    if (size.width === candidate.width && size.height === candidate.height) return { ratio, tier }
  }
  const aspect = size.width / size.height
  const ratio = Number.isFinite(aspect) && aspect > 0
    ? VIDEO_EDIT_SEQUENCE_RATIOS.find(value => Math.abs(aspect / videoEditSequenceRatioValue(value) - 1) < .005 || value === '21:9' && VIDEO_EDIT_SEQUENCE_TIERS.some(({ label }) => { const size = standardVideoEditSequenceSize(value, label); return Math.abs(aspect / (size.width / size.height) - 1) < .002 }))
    : undefined
  return { ratio: ratio ?? '自定义', tier: '自定义' }
}
export function videoEditSequenceRatioLabel(size: VideoEditSequenceSize): string {
  if (![size.width, size.height].every(value => Number.isInteger(value) && value > 0)) return ''
  let a = size.width; let b = size.height
  while (b) { const remainder = a % b; a = b; b = remainder }
  const width = size.width / a; const height = size.height / a
  return width <= 99 && height <= 99 ? `${width}:${height}` : `${(size.width / size.height).toFixed(2)}:1`
}
