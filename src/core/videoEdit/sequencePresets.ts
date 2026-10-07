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
export function videoEditSequenceRatioValue(ratio: VideoEditSequenceRatio): number {
  const [width, height] = ratio.split(':').map(Number)
  return width / height
}
export function videoEditSequenceTierSize(aspect: number, tier: VideoEditSequenceTier): VideoEditSequenceSize {
  return videoEditSequenceSizeForPixels(VIDEO_EDIT_SEQUENCE_TIERS.find(value => value.label === tier)!.pixels, aspect)
}
export function videoEditSequencePresetSize(ratio: VideoEditSequenceRatio, tier: VideoEditSequenceTier): VideoEditSequenceSize {
  return videoEditSequenceTierSize(videoEditSequenceRatioValue(ratio), tier)
}
export function inferVideoEditSequencePreset(size: VideoEditSequenceSize): VideoEditSequencePreset {
  for (const ratio of VIDEO_EDIT_SEQUENCE_RATIOS) for (const { label: tier } of VIDEO_EDIT_SEQUENCE_TIERS) {
    const candidate = videoEditSequencePresetSize(ratio, tier)
    if (size.width === candidate.width && size.height === candidate.height) return { ratio, tier }
  }
  const aspect = size.width / size.height
  const ratio = Number.isFinite(aspect) && aspect > 0
    ? VIDEO_EDIT_SEQUENCE_RATIOS.find(value => Math.abs(aspect / videoEditSequenceRatioValue(value) - 1) < .005)
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
