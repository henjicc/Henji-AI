import { videoEditSequenceSchema } from './document'

/** 新序列的应用偏好，不包含名称、素材箱或任何内容。 */
export const videoEditSequenceDefaultsSchema = videoEditSequenceSchema.pick({ width: true, height: true, frameRate: true, pixelAspectRatio: true, sampleRate: true, channels: true })
export type VideoEditSequenceDefaults = import('zod').infer<typeof videoEditSequenceDefaultsSchema>
export const VIDEO_EDIT_SEQUENCE_DEFAULTS: VideoEditSequenceDefaults = { width: 1920, height: 1080, frameRate: { numerator: 60, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2 }
