import { z } from 'zod'

export const VIDEO_EDIT_SEQUENCE_LIMITS = Object.freeze({ minDimension: 16, maxDimension: 8192, maxPixels: 7680 * 4320 })
export interface VideoEditSequenceSize { width: number; height: number }
export const videoEditSequenceSizeFields = {
  width: z.number().int().min(VIDEO_EDIT_SEQUENCE_LIMITS.minDimension).max(VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension),
  height: z.number().int().min(VIDEO_EDIT_SEQUENCE_LIMITS.minDimension).max(VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension),
}
export function isVideoEditSequenceSize(size: VideoEditSequenceSize): boolean {
  return [size.width, size.height].every(value => Number.isInteger(value) && value >= VIDEO_EDIT_SEQUENCE_LIMITS.minDimension && value <= VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension) && size.width * size.height <= VIDEO_EDIT_SEQUENCE_LIMITS.maxPixels
}
export const videoEditSequenceSizeSchema = z.object(videoEditSequenceSizeFields).strict().refine(isVideoEditSequenceSize, '超过 8K 上限。')
/** 素材超过序列范围时等比缩小；合法原尺寸原样保留。 */
export function clampVideoEditSequenceSize(size: VideoEditSequenceSize): VideoEditSequenceSize {
  const width = Math.max(VIDEO_EDIT_SEQUENCE_LIMITS.minDimension, Number.isFinite(size.width) ? size.width : VIDEO_EDIT_SEQUENCE_LIMITS.minDimension)
  const height = Math.max(VIDEO_EDIT_SEQUENCE_LIMITS.minDimension, Number.isFinite(size.height) ? size.height : VIDEO_EDIT_SEQUENCE_LIMITS.minDimension)
  const scale = Math.min(1, VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension / width, VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension / height, Math.sqrt(VIDEO_EDIT_SEQUENCE_LIMITS.maxPixels / (width * height)))
  return { width: Math.max(VIDEO_EDIT_SEQUENCE_LIMITS.minDimension, Math.floor(width * scale)), height: Math.max(VIDEO_EDIT_SEQUENCE_LIMITS.minDimension, Math.floor(height * scale)) }
}
