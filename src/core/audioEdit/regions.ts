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

/**
 * 把音量区域乘到一段交错 PCM 上（startFrame 是这段在源里的起点帧）。区域内为 gainDb；淡入从静音渐入到该音量、
 * 淡出从该音量渐出到静音（与“淡入 / 淡出”的含义一致）；重叠的区域相乘。区域再多也是逐帧一次乘法。
 */
export function applyAudioEditGainRegions(pcm: Float32Array, startFrame: number, channels: number, regions: readonly AudioEditGainRegion[]): void {
  const end = startFrame + Math.floor(pcm.length / channels)
  for (const region of regions) {
    if (!region.enabled || region.endFrame <= startFrame || region.startFrame >= end) continue
    const gain = 10 ** (region.gainDb / 20)
    for (let frame = Math.max(startFrame, region.startFrame), last = Math.min(end, region.endFrame); frame < last; frame++) {
      const fadeIn = region.fadeInFrames ? Math.min(1, (frame - region.startFrame) / region.fadeInFrames) : 1
      const fadeOut = region.fadeOutFrames ? Math.min(1, (region.endFrame - 1 - frame) / region.fadeOutFrames) : 1
      const factor = gain * fadeIn * fadeOut
      for (let channel = 0, at = (frame - startFrame) * channels; channel < channels; channel++) pcm[at + channel] *= factor
    }
  }
}

export interface AudioEditRenderedAudio { audioPath: string; durationFrames: number; sampleRate: number; channels: number; revision: number }
