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
/**
 * 口水音（口腔咔嗒声）修复：自动检测出的咔嗒位置，整体开关一次修完（LPC 插值，同一遍处理最多 4096 处，超出分批）。
 * sensitivity 是检测时用的灵敏度（重新检测时沿用）；单处可以删掉不修。
 */
export const audioEditMouthClicksSchema = z.object({
  enabled: z.boolean(), sensitivity: z.number().finite().min(0).max(100),
  clicks: z.array(z.object({ startFrame: frame, endFrame: frame }).strict().refine(r => r.endFrame > r.startFrame && r.endFrame - r.startFrame <= 48000, '口水音范围无效')).max(20000),
}).strict()
export type AudioEditMouthClicks = z.infer<typeof audioEditMouthClicksSchema>
export const audioEditRepairsSchema = z.array(audioEditRepairSchema).max(10000)
export type AudioEditGainRegion = z.infer<typeof audioEditGainRegionSchema>
export type AudioEditRepair = z.infer<typeof audioEditRepairSchema>

/**
 * 决定声音的那部分修复与区间音量：只取已生效的，去掉 id 与开关，区间音量按时间排序（重叠相乘，与顺序无关）。
 * 呼吸、气口被改成手动剪辑时只换 id、不改声音；编辑后的波形、频谱和渲染缓存都按它判断要不要重算。
 */
export function audioEditSoundRecipe(repairs: readonly AudioEditRepair[] | undefined, gains: readonly AudioEditGainRegion[] | undefined) {
  return {
    repairs: (repairs ?? []).filter(repair => repair.enabled && repair.strength > 0).map(({ id: _id, enabled: _enabled, ...recipe }) => recipe),
    gains: (gains ?? []).filter(region => region.enabled).map(({ id: _id, enabled: _enabled, ...recipe }) => recipe)
      .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame || a.gainDb - b.gainDb),
  }
}

/**
 * 编辑后声音（时间轴同原素材）的完整配方：修复、口水音、离线模型处理（减少混响、人声分离）、区间音量。
 * 为空表示编辑后声音就是原素材；波形、频谱与预览按它判断要不要换成编辑后的声音、要不要重算。
 */
export function audioEditSourceRecipe(project: { repairs?: readonly AudioEditRepair[]; gainRegions?: readonly AudioEditGainRegion[]; mouthClicks?: AudioEditMouthClicks; offline?: ReadonlyArray<{ kind: string; amount: number }> }) {
  const sound = audioEditSoundRecipe(project.repairs, project.gainRegions)
  return { ...sound, clicks: project.mouthClicks?.enabled ? project.mouthClicks.clicks : [], offline: project.offline ?? [] }
}
export function audioEditSourceEdited(recipe: ReturnType<typeof audioEditSourceRecipe>): boolean {
  return recipe.repairs.length > 0 || recipe.gains.length > 0 || recipe.clicks.length > 0 || recipe.offline.length > 0
}

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
