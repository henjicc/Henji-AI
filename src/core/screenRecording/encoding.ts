import { z } from 'zod'

/** 偏好与采集共用编码选项；省略字段由执行入口解析默认值。码率统一存 bps。 */
export const recordingEncodingFields = {
  rateControl: z.enum(['quality', 'vbr', 'cbr']).optional(),
  bitrate: z.number().int().min(1_000_000).max(100_000_000).optional(),
  /** 省略为自动：最长 {@link AUTO_KEYFRAME_FRAMES} 帧，画面突变（切窗口、翻页）时编码器补关键帧；数字：严格固定间隔。 */
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

/** 解析后的编码选项可直接写入采集选项；关键帧省略即自动。 */
export type ResolvedRecordingEncoding = Required<Omit<RecordingEncoding, 'keyframeFrames'>> & Pick<RecordingEncoding, 'keyframeFrames'>
export function recordingEncoding(options: RecordingEncoding & { width: number; height: number; fps: number }): ResolvedRecordingEncoding {
  const row = RECORDING_VIDEO_DEFAULTS.find(row => options.width * options.height <= row.width * row.height) ?? RECORDING_VIDEO_DEFAULTS[2]
  const codec = options.codec ?? 'h264'
  return { codec, encoder: options.encoder ?? 'auto', rateControl: options.rateControl ?? 'quality', ...(options.keyframeFrames ? { keyframeFrames: options.keyframeFrames } : {}),
    bitrate: options.bitrate ?? Math.round((options.fps > 30 ? row.bitrate60 : row.bitrate30) * (codec === 'hevc' ? .7 : 1) * 1_000_000) }
}

export const AUTO_KEYFRAME_FRAMES = 30
/** 拖动定位的最坏等待只取决于最长间隔；突变处补关键帧让剪切点落在关键帧上、突变画面不糊。 */
export function recordingKeyframes(keyframeFrames: RecordingEncoding['keyframeFrames']): { gop: number; sceneCut: boolean } {
  return keyframeFrames ? { gop: keyframeFrames, sceneCut: false } : { gop: AUTO_KEYFRAME_FRAMES, sceneCut: true }
}
