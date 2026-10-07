import { z } from 'zod'
import { videoEditLoudnessSettingsSchema } from './loudness'
import { videoEditSequenceSizeFields, isVideoEditSequenceSize } from './sequenceSize'

export const videoEditExportSettingsSchema = z.object({
  format: z.enum(['mp4', 'aac', 'wav']),
  width: videoEditSequenceSizeFields.width.refine(value => value % 2 === 0, '宽度必须是偶数。'),
  height: videoEditSequenceSizeFields.height.refine(value => value % 2 === 0, '高度必须是偶数。'),
  fps: z.number().min(1).max(120).nullable().describe('null 表示保持序列帧率。'),
  videoBitrateMbps: z.number().min(.1).max(200), audioBitrateKbps: z.number().int().min(32).max(512),
  fit: z.enum(['fit', 'fill', 'letterbox']).describe('fit 适合：保持完整画面并居中；fill 填充：按中心裁切铺满；letterbox 留黑边：保持完整画面并明确补黑边。适合与留黑边在不透明成片中相同。'),
  loudness: videoEditLoudnessSettingsSchema.nullable(),
  codec: z.enum(['avc', 'hevc']).default('avc').describe('avc 为 H.264，hevc 为 H.265；严格使用所选编码，不自动替换。'),
  bitrateMode: z.enum(['vbr', 'cbr']).default('vbr').describe('vbr 可变码率，cbr 恒定码率；以设备对实际规格的支持为准。'),
  keyframeInterval: z.union([z.literal('auto'), z.literal(1), z.literal(2)]).default('auto').describe('关键帧间隔，单位秒；auto 使用编码器默认值。'),
  encoderPreference: z.enum(['hardware', 'software']).default('hardware').describe('硬件加速或软件编码；提交前探测实际规格。'),
  videoEnabled: z.boolean().default(true).describe('false 仅导出声音；输出格式随 audioCodec 变为 AAC 或 WAV。'),
  audioEnabled: z.boolean().default(true).describe('false 导出无声视频；音视频不能同时关闭。'),
  audioCodec: z.enum(['aac', 'wav']).default('aac').describe('wav 使用 24 位 PCM；视频中的 PCM 仍封装为 MP4。'),
  sampleRate: z.union([z.literal(44100), z.literal(48000)]).default(48000).describe('输出采样率 Hz，followSequence.sampleRate 开启时由序列决定。'),
  channels: z.union([z.literal(1), z.literal(2)]).default(2).describe('1 单声道，2 立体声；可跟随序列。'),
  captionMode: z.enum(['none', 'burn', 'srt', 'vtt']).default('none').describe('none 不输出字幕；burn 烧录到视频；srt/vtt 同名文件放在成片目录，以导出入点为零时刻。'),
  followSequence: z.object({ resolution: z.boolean(), fps: z.boolean(), sampleRate: z.boolean(), channels: z.boolean() }).strict().default({ resolution: false, fps: false, sampleRate: true, channels: true }).describe('每项为 true 时，在提交时读取目标序列的规格；解锁后用对应设置值。'),
  importToProject: z.boolean().default(false).describe('成片完成后导入原剪辑素材箱，不自动放上时间线。'),
  addToLibrary: z.boolean().default(true).describe('成片完成后沿正式收录入口加入资产库；失败保留成片。'),
  useProxies: z.boolean().default(false).describe('显式使用已有且核验过的代理画面导出；缺代理的素材使用原片，声音始终使用原片。'),
}).strict().refine(isVideoEditSequenceSize, '超过 8K 上限。').superRefine((value, ctx) => {
  if (!value.videoEnabled && !value.audioEnabled) ctx.addIssue({ code: 'custom', path: ['audioEnabled'], message: '视频与音频不能同时关闭。' })
  if (value.videoEnabled && value.format !== 'mp4') ctx.addIssue({ code: 'custom', path: ['format'], message: '视频必须使用 MP4 格式。' })
  if (!value.videoEnabled && value.format !== value.audioCodec) ctx.addIssue({ code: 'custom', path: ['format'], message: '仅音频的格式须与音频编码一致。' })
  if (!value.videoEnabled && value.captionMode === 'burn') ctx.addIssue({ code: 'custom', path: ['captionMode'], message: '仅音频不能烧录字幕，请选择单独字幕文件。' })
})
export type VideoEditExportSettings = z.infer<typeof videoEditExportSettingsSchema>
export const videoEditExportPresetSchema = z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), settings: videoEditExportSettingsSchema }).strict()
export type VideoEditExportPreset = z.infer<typeof videoEditExportPresetSchema>
const preset = (id: string, name: string, width: number, height: number, videoBitrateMbps = 12, format: VideoEditExportSettings['format'] = 'mp4', fps: number | null = 30): VideoEditExportPreset => ({
  id: `builtin:${id}`, name, settings: videoEditExportSettingsSchema.parse({ format, width, height, fps, videoBitrateMbps, audioBitrateKbps: 192, fit: 'fit', loudness: { targetLufs: -14, truePeakDbtp: -1 }, videoEnabled: format === 'mp4', audioCodec: format === 'wav' ? 'wav' : 'aac' }),
})
export const VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID = 'builtin:sequence'
export const VIDEO_EDIT_EXPORT_PRESETS: readonly VideoEditExportPreset[] = [
  { ...preset('sequence', '与序列一致', 1920, 1080, 12, 'mp4', null), settings: { ...preset('sequence', '', 1920, 1080).settings, fps: null, followSequence: { resolution: true, fps: true, sampleRate: true, channels: true } } },
  preset('douyin', '抖音 · 竖版 1080p', 1080, 1920), preset('channels', '视频号 · 竖版 1080p', 1080, 1920),
  preset('bilibili', 'B 站 · 横版 1080p', 1920, 1080), preset('bilibili-4k', 'B 站 · 横版 4K', 3840, 2160, 45),
  preset('youtube', 'YouTube · 横版 1080p', 1920, 1080), preset('youtube-4k', 'YouTube · 横版 4K', 3840, 2160, 45),
  preset('instagram', 'Instagram · 方形', 1080, 1080), preset('aac', '仅音频 · AAC', 1920, 1080, 12, 'aac', null),
  { ...preset('wav', '仅音频 · WAV 无损', 1920, 1080, 12, 'wav', null), settings: { ...preset('wav', '', 1920, 1080, 12, 'wav', null).settings, loudness: null } },
  { ...preset('master', '高质量母版 · 原画幅', 1920, 1080, 80, 'mp4', null), settings: { ...preset('master', '', 1920, 1080, 80, 'mp4', null).settings, codec: 'hevc', loudness: null, followSequence: { resolution: true, fps: true, sampleRate: true, channels: true } } },
]
export interface VideoEditExportSequenceSpec { width: number; height: number; fps: number; sampleRate: number; channels: number }
export function resolveVideoEditExportSettings(input: VideoEditExportSettings, sequence: VideoEditExportSequenceSpec): VideoEditExportSettings {
  const value = videoEditExportSettingsSchema.parse(input)
  return videoEditExportSettingsSchema.parse({ ...value,
    ...(value.followSequence.resolution ? { width: sequence.width, height: sequence.height } : {}),
    fps: value.followSequence.fps || value.fps === null ? sequence.fps : value.fps,
    ...(value.followSequence.sampleRate ? { sampleRate: sequence.sampleRate } : {}),
    ...(value.followSequence.channels ? { channels: sequence.channels } : {}),
  })
}
export function videoEditSequenceExportSettings(sequence: VideoEditExportSequenceSpec): VideoEditExportSettings {
  const bitrate = sequence.width * sequence.height >= 7680 * 4320 ? 100 : sequence.width * sequence.height >= 3840 * 2160 ? 50 : sequence.width * sequence.height >= 1920 * 1080 ? 12 : 6
  return resolveVideoEditExportSettings({ ...VIDEO_EDIT_EXPORT_PRESETS[0].settings, videoBitrateMbps: bitrate }, sequence)
}
/** The same transition is used by controls and settings callers, keeping container/stream constraints together. */
export function patchVideoEditExportSettings(settings: VideoEditExportSettings, patch: Partial<VideoEditExportSettings>): VideoEditExportSettings {
  const value = { ...settings, ...patch }
  if (patch.format === 'aac' || patch.format === 'wav') { value.videoEnabled = false; value.audioEnabled = true; value.audioCodec = patch.format }
  if (patch.format === 'mp4') value.videoEnabled = true
  if (patch.videoEnabled === false || !value.videoEnabled && patch.audioCodec) { value.format = value.audioCodec; value.audioEnabled = true }
  if (patch.videoEnabled === true) value.format = 'mp4'
  if (!value.videoEnabled && value.captionMode === 'burn') value.captionMode = 'srt'
  return value
}
export function videoEditExportEstimatedBytes(settings: VideoEditExportSettings, durationSeconds: number): number {
  const video = settings.videoEnabled ? settings.videoBitrateMbps * 1_000_000 : 0
  const audio = settings.audioEnabled ? settings.audioCodec === 'wav' ? settings.sampleRate * settings.channels * 24 : settings.audioBitrateKbps * 1000 : 0
  return Math.max(0, durationSeconds) * (video + audio) / 8
}
export function videoEditExportPaths(path: string, settings: VideoEditExportSettings): string[] {
  return settings.captionMode === 'srt' || settings.captionMode === 'vtt' ? [path, `${path.replace(/\.[^./\\]+$/, '')}.${settings.captionMode}`] : [path]
}
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
  return { fps: parsed.followSequence.fps ? sequenceFps : parsed.fps ?? sequenceFps, videoBitrate: Math.round(parsed.videoBitrateMbps * 1_000_000), audioBitrate: parsed.audioBitrateKbps * 1000, audioCodec: parsed.audioCodec === 'wav' ? 'pcm-s24' : 'aac' }
}
