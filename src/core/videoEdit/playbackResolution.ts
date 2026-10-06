import { z } from 'zod'

/**
 * 节目监视器的回放分辨率（对齐 Premiere“回放分辨率”与“暂停分辨率”，任务 4.9）：只是看片时的视图偏好，
 * 不进剪辑文件与撤销栈；导出、选帧、设为封面一律按序列完整分辨率渲染。
 */
export const VIDEO_EDIT_PLAYBACK_RESOLUTIONS = ['full', 'half', 'quarter', 'eighth'] as const
export type VideoEditPlaybackResolution = typeof VIDEO_EDIT_PLAYBACK_RESOLUTIONS[number]
export const videoEditPlaybackResolutionSchema = z.object({
  resolution: z.enum(VIDEO_EDIT_PLAYBACK_RESOLUTIONS),
  fullWhenPaused: z.boolean(),
}).strict()
export type VideoEditPlaybackResolutionSetting = z.infer<typeof videoEditPlaybackResolutionSchema>
export const VIDEO_EDIT_DEFAULT_PLAYBACK_RESOLUTION: VideoEditPlaybackResolutionSetting = { resolution: 'full', fullWhenPaused: true }
export const VIDEO_EDIT_PLAYBACK_RESOLUTION_LABELS: Record<VideoEditPlaybackResolution, string> = { full: '完整', half: '1/2', quarter: '1/4', eighth: '1/8' }
const DIVISORS: Record<VideoEditPlaybackResolution, 1 | 2 | 4 | 8> = { full: 1, half: 2, quarter: 4, eighth: 8 }
export type VideoEditRenderDivisor = 1 | 2 | 4 | 8
export function isVideoEditRenderDivisor(value: unknown): value is VideoEditRenderDivisor { return value === 1 || value === 2 || value === 4 || value === 8 }

/** 节目当前该用的渲染缩小倍数：播放时用所选分辨率；暂停时默认回到完整，除非设为“暂停时也用此分辨率”。 */
export function videoEditPreviewDivisor(setting: VideoEditPlaybackResolutionSetting, playing: boolean): VideoEditRenderDivisor {
  return playing || !setting.fullWhenPaused ? DIVISORS[setting.resolution] : 1
}

/** 按缩小倍数算渲染画布尺寸（至少 1 像素）；画面比例按四舍五入保持，最多差半个像素。 */
export function videoEditRenderSize(width: number, height: number, divisor: VideoEditRenderDivisor): { width: number; height: number } {
  return divisor === 1 ? { width, height } : { width: Math.max(1, Math.round(width / divisor)), height: Math.max(1, Math.round(height / divisor)) }
}
