import { z } from 'zod'

/** 偏好与采集共用编码选项；省略字段由执行入口解析默认值。码率统一存 bps。 */
export const recordingEncodingFields = {
  rateControl: z.enum(['quality', 'vbr', 'cbr']).optional(),
  bitrate: z.number().int().min(1_000_000).max(100_000_000).optional(),
  keyframeFrames: z.union([z.literal(10), z.literal(15), z.literal(30), z.literal(60), z.literal(120)]).optional(),
  codec: z.enum(['h264', 'hevc']).optional(),
  encoder: z.enum(['auto', 'nvidia', 'intel', 'amd', 'apple', 'software']).optional(),
}
export const recordingEncodingSchema = z.object(recordingEncodingFields).strict()
export type RecordingEncoding = z.infer<typeof recordingEncodingSchema>
export type RecordingEncoder = NonNullable<RecordingEncoding['encoder']>
export type RecordingCodec = NonNullable<RecordingEncoding['codec']>
export const RECORDING_VIDEO_DEFAULTS = [
  { width: 1920, height: 1080, bitrate30: 12, bitrate60: 18 },
  { width: 2560, height: 1440, bitrate30: 20, bitrate60: 28 },
  { width: 3840, height: 2160, bitrate30: 28, bitrate60: 40 },
] as const

export function recordingEncoding(options: RecordingEncoding & { width: number; height: number; fps: number }): Required<RecordingEncoding> {
  const row = RECORDING_VIDEO_DEFAULTS.find(row => options.width * options.height <= row.width * row.height) ?? RECORDING_VIDEO_DEFAULTS[2]
  const codec = options.codec ?? 'h264'
  return { codec, encoder: options.encoder ?? 'auto', rateControl: options.rateControl ?? 'quality', keyframeFrames: options.keyframeFrames ?? 30,
    bitrate: options.bitrate ?? Math.round((options.fps > 30 ? row.bitrate60 : row.bitrate30) * (codec === 'hevc' ? .7 : 1) * 1_000_000) }
}
