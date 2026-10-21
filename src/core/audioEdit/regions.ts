import { z } from 'zod'

const frame = z.number().int().nonnegative()
const base = { id: z.string().min(1).max(200), startFrame: frame, endFrame: frame, enabled: z.boolean() }
export const audioEditGainRegionSchema = z.object({
  ...base, gainDb: z.number().min(-120).max(36), fadeInFrames: frame, fadeOutFrames: frame,
}).strict().refine(r => r.endFrame > r.startFrame && r.fadeInFrames + r.fadeOutFrames <= r.endFrame - r.startFrame, '音量区域或淡变时长无效')

/** Coordinates are normalized inside the repair rectangle; radius uses the same normalized axes. */
export const audioEditBrushStrokeSchema = z.object({
  radius: z.number().positive().max(1),
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
  hop: z.number().int().positive().max(8192).optional(), channel: frame.optional(), requestId: z.string().min(1).optional(),
}).strict().refine(r => r.endFrame > r.startFrame && (r.hop ?? r.fftSize / 4) <= r.fftSize, '频谱范围或步长无效')
export type AudioEditSpectrogramRequest = z.input<typeof audioEditSpectrogramRequestSchema>
export interface AudioEditSpectrogramChunk {
  sampleRate: number; channels: number; fftSize: number; hop: number
  startFrame: number; endFrame: number; timeBins: number; frequencyBins: number
  /** channel-major, then time, then ascending frequency; dB = value / 255 * 120 - 120. */
  values: Uint8Array
}
export interface AudioEditRenderedAudio { audioPath: string; durationFrames: number; sampleRate: number; channels: number; revision: number }
