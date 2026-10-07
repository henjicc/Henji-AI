import { videoEditSequenceSchema } from './document'
import { z } from 'zod'
import { isVideoEditSequenceSize, videoEditSequenceSizeFields } from './sequenceSize'

/** 新序列的应用偏好，不包含名称、素材箱或任何内容。 */
export const videoEditSequenceDefaultsSchema = z.object({
  ...videoEditSequenceSizeFields,
  frameRate: videoEditSequenceSchema.shape.frameRate, pixelAspectRatio: videoEditSequenceSchema.shape.pixelAspectRatio,
  sampleRate: videoEditSequenceSchema.shape.sampleRate, channels: videoEditSequenceSchema.shape.channels,
}).strict().refine(isVideoEditSequenceSize, '超过 8K 上限。')
export type VideoEditSequenceDefaults = import('zod').infer<typeof videoEditSequenceDefaultsSchema>
export const VIDEO_EDIT_SEQUENCE_DEFAULTS: VideoEditSequenceDefaults = { width: 1920, height: 1080, frameRate: { numerator: 60, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2 }
