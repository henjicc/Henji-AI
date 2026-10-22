import { z } from 'zod'

const frame = z.number().int().nonnegative()
const base = { id: z.string().min(1).max(200), startFrame: frame, endFrame: frame, enabled: z.boolean() }
export const audioEditGainRegionSchema = z.object({
  ...base, gainDb: z.number().min(-120).max(36), fadeInFrames: frame, fadeOutFrames: frame,
}).strict().refine(r => r.endFrame > r.startFrame && r.fadeInFrames + r.fadeOutFrames <= r.endFrame - r.startFrame, '音量区域或淡变时长无效')

/**
 * Coordinates are normalized inside the repair rectangle (x = time, y = frequency from low to high).
 * radius is the horizontal radius; radiusY (optional, defaults to radius) is the vertical one, so a round
 * brush on screen stays round after the rectangle is stretched to the repair's time and frequency span.
 */
export const audioEditBrushStrokeSchema = z.object({
  radius: z.number().positive().max(1), radiusY: z.number().positive().max(1).optional(),
  points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(1).max(10000),
}).strict()
export const audioEditRepairSchema = z.object({
  ...base, kind: z.enum(['spectral_heal', 'declick']),
  lowHz: z.number().nonnegative(), highHz: z.number().positive(),
  strength: z.number().min(0).max(1), strokes: z.array(audioEditBrushStrokeSchema).max(1000).optional(),
}).strict().refine(r => r.endFrame > r.startFrame && r.highHz > r.lowHz, '修复时间或频率范围无效')
export const audioEditGainRegionsSchema = z.array(audioEditGainRegionSchema).max(10000)
export const audioEditRepairsSchema = z.array(audioEditRepairSchema).max(10000)
export type AudioEditGainRegion = z.infer<typeof audioEditGainRegionSchema>
export type AudioEditRepair = z.infer<typeof audioEditRepairSchema>

export const audioEditSpectrogramRequestSchema = z.object({
  projectId: z.string().min(1), startFrame: frame, endFrame: frame,
  mode: z.enum(['source', 'edited']).default('source'),
  fftSize: z.number().int().min(256).max(8192).refine(n => (n & (n - 1)) === 0).default(2048),
  /** 相邻两列的间隔（采样帧）。大于 fftSize 时每列只算一个窗口：缩小看长音频时按屏幕列数取样。 */
  hop: z.number().int().positive().max(1 << 24).optional(), channel: frame.optional(), requestId: z.string().min(1).optional(),
}).strict().refine(r => r.endFrame > r.startFrame, '频谱范围无效')
export type AudioEditSpectrogramRequest = z.input<typeof audioEditSpectrogramRequestSchema>
export interface AudioEditSpectrogramChunk {
  sampleRate: number; channels: number; fftSize: number; hop: number
  /** 返回固定块覆盖范围，起点可能早于请求；长范围从 endFrame 继续，消费者按时间戳裁取。 */
  startFrame: number; endFrame: number; timeBins: number; frequencyBins: number
  /** channel-major, then time, then ascending frequency; dB = value / 255 * 120 - 120. */
  values: Uint8Array
}
export interface AudioEditRenderedAudio { audioPath: string; durationFrames: number; sampleRate: number; channels: number; revision: number }
