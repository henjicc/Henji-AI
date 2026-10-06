import { z } from 'zod'
import { videoEditLoudnessSettingsSchema } from './loudness'

export const videoEditExportSettingsSchema = z.object({
  format: z.enum(['mp4', 'aac', 'wav']),
  width: z.number().int().min(16).max(7680).refine(value => value % 2 === 0, '宽度必须是偶数。'),
  height: z.number().int().min(16).max(7680).refine(value => value % 2 === 0, '高度必须是偶数。'),
  fps: z.number().min(1).max(120).nullable().describe('null 表示保持序列帧率。'),
  videoBitrateMbps: z.number().min(.1).max(200), audioBitrateKbps: z.number().int().min(32).max(512),
  fit: z.enum(['fit', 'fill', 'letterbox']).describe('fit 适合：保持完整画面并居中；fill 填充：按中心裁切铺满；letterbox 留黑边：保持完整画面并明确补黑边。适合与留黑边在不透明成片中相同。'),
  loudness: videoEditLoudnessSettingsSchema.nullable(),
  keepSequenceSize: z.boolean().optional(),
}).strict()
export type VideoEditExportSettings = z.infer<typeof videoEditExportSettingsSchema>
export const videoEditExportPresetSchema = z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), settings: videoEditExportSettingsSchema }).strict()
export type VideoEditExportPreset = z.infer<typeof videoEditExportPresetSchema>
const preset = (id: string, name: string, width: number, height: number, videoBitrateMbps = 12, format: VideoEditExportSettings['format'] = 'mp4', fps: number | null = 30): VideoEditExportPreset => ({
  id: `builtin:${id}`, name, settings: { format, width, height, fps, videoBitrateMbps, audioBitrateKbps: 192, fit: 'fit', loudness: { targetLufs: -14, truePeakDbtp: -1 } },
})
export const VIDEO_EDIT_EXPORT_PRESETS: readonly VideoEditExportPreset[] = [
  preset('douyin', '抖音 · 竖版 1080p', 1080, 1920), preset('channels', '视频号 · 竖版 1080p', 1080, 1920),
  preset('bilibili', 'B 站 · 横版 1080p', 1920, 1080), preset('bilibili-4k', 'B 站 · 横版 4K', 3840, 2160, 45),
  preset('youtube', 'YouTube · 横版 1080p', 1920, 1080), preset('youtube-4k', 'YouTube · 横版 4K', 3840, 2160, 45),
  preset('instagram', 'Instagram · 方形', 1080, 1080), preset('aac', '仅音频 · AAC', 1920, 1080, 12, 'aac', null),
  { ...preset('wav', '仅音频 · WAV 无损', 1920, 1080, 12, 'wav', null), settings: { ...preset('wav', '', 1920, 1080).settings, format: 'wav', fps: null, loudness: null } },
  { ...preset('master', '高质量母版 · 原画幅', 1920, 1080, 80, 'mp4', null), settings: { ...preset('master', '', 1920, 1080, 80, 'mp4', null).settings, audioBitrateKbps: 320, loudness: null, keepSequenceSize: true } },
]
export interface VideoEditExportGeometry { source: { x: number; y: number; width: number; height: number }; destination: { x: number; y: number; width: number; height: number } }
export function videoEditExportGeometry(sourceWidth: number, sourceHeight: number, settings: VideoEditExportSettings): VideoEditExportGeometry {
  if (![sourceWidth, sourceHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error('原序列画幅无效。')
  const { width, height, fit } = videoEditExportSettingsSchema.parse(settings)
  const scale = fit === 'fill' ? Math.max(width / sourceWidth, height / sourceHeight) : Math.min(width / sourceWidth, height / sourceHeight)
  return fit === 'fill' ? { source: { x: (sourceWidth - width / scale) / 2, y: (sourceHeight - height / scale) / 2, width: width / scale, height: height / scale }, destination: { x: 0, y: 0, width, height } }
    : { source: { x: 0, y: 0, width: sourceWidth, height: sourceHeight }, destination: { x: (width - sourceWidth * scale) / 2, y: (height - sourceHeight * scale) / 2, width: sourceWidth * scale, height: sourceHeight * scale } }
}
export function videoEditExportEncoding(settings: VideoEditExportSettings, sequenceFps: number): { fps: number; videoBitrate: number; audioBitrate: number; audioCodec: 'aac' | 'pcm-s24' } {
  const parsed = videoEditExportSettingsSchema.parse(settings)
  return { fps: parsed.fps ?? sequenceFps, videoBitrate: Math.round(parsed.videoBitrateMbps * 1_000_000), audioBitrate: parsed.audioBitrateKbps * 1000, audioCodec: parsed.format === 'wav' ? 'pcm-s24' : 'aac' }
}
