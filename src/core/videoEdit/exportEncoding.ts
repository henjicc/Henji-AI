import { z } from 'zod'
import type { VideoEditExportSettings, VideoEditExportPreset } from './exportPresets'

export const VIDEO_EDIT_EXPORT_AVC_LEVELS = ['auto', '3', '3.1', '3.2', '4', '4.1', '4.2', '5', '5.1', '5.2', '6', '6.1', '6.2'] as const
export const VIDEO_EDIT_EXPORT_HEVC_LEVELS = ['auto', '3', '3.1', '4', '4.1', '5', '5.1', '5.2', '6', '6.1', '6.2'] as const
export function videoEditExportLevels(codec: 'avc' | 'hevc'): readonly string[] { return codec === 'hevc' ? VIDEO_EDIT_EXPORT_HEVC_LEVELS : VIDEO_EDIT_EXPORT_AVC_LEVELS }
export const VIDEO_EDIT_EXPORT_ENCODERS = ['h264_nvenc', 'hevc_nvenc', 'libx264', 'libx265'] as const
export const videoEditExportQualitySchema = z.enum(['visually_lossless', 'high', 'standard', 'bitrate']).describe('视觉无损、高画质、标准画质或指定码率；按设备选用同一视频格式的编码器。')
export type VideoEditExportQuality = z.infer<typeof videoEditExportQualitySchema>
export const videoEditExportEncodingSchema = z.object({
  encoder: z.enum(VIDEO_EDIT_EXPORT_ENCODERS).describe('NVIDIA 硬件 H.264/H.265 或软件 H.264/H.265。'),
  rateControl: z.enum(['quality', 'vbr', 'cbr', 'two_pass']).describe('按画质、可变码率、恒定码率或两遍分析；NVIDIA 两遍分析在编码器内部进行。'),
  quality: z.number().min(0).max(51).describe('画质数值，越低越清晰、文件越大；硬件使用 CQ，软件使用 CRF。'),
  maxBitrateMbps: z.number().nonnegative().describe('最大码率，Mbps；0 不限制。'),
  bufferMbps: z.number().nonnegative().describe('码率缓冲容量，兆比特；0 使用最大码率的两倍；未限制最大码率时由编码器决定。'),
  preset: z.enum(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo']).describe('硬件 p1 最快、p7 最精细；软件从 ultrafast 到 placebo 逐渐变慢。'),
  profile: z.enum(['auto', 'baseline', 'main', 'high', 'high10', 'main10']).describe('兼容规格；auto 按视频格式和位深选择。'),
  level: z.enum(VIDEO_EDIT_EXPORT_AVC_LEVELS).describe('解码设备兼容级别；auto 自动选择。'),
  keyframeSeconds: z.number().positive().describe('关键帧间隔，秒。'),
  bFrames: z.number().int().min(0).max(16).describe('连续 B 帧数；0 关闭。'),
  lookaheadFrames: z.number().int().nonnegative().describe('前瞻分析帧数；0 关闭，设备支持范围由编码器决定。'),
  spatialAq: z.boolean().describe('优先给空间细节分配码率。'),
  temporalAq: z.boolean().describe('优先给跨帧细节分配码率；仅 NVIDIA 支持。'),
  colorRange: z.enum(['limited', 'full']).describe('有限或完整色彩范围。'),
  colorMatrix: z.enum(['bt709', 'bt2020nc', 'smpte170m']).describe('输出 YUV 色彩矩阵；常规高清使用 BT.709。'),
  tenBit: z.boolean().describe('输出 10 位视频；不增加源画面已有的色彩精度。'),
}).strict().superRefine((value, ctx) => {
  const nvenc = value.encoder.endsWith('_nvenc')
  const issue = (field: keyof typeof value, message: string): void => ctx.addIssue({ code: 'custom', path: [field], message })
  if (nvenc && value.quality < 1) issue('quality', 'NVIDIA 画质数值至少为 1；0 会关闭恒定画质。')
  if (nvenc !== /^p[1-7]$/.test(value.preset)) issue('preset', '速度档与所选硬件或软件编码器不匹配。')
  if (!nvenc && value.temporalAq) issue('temporalAq', '软件编码器不支持时间 AQ。')
  if (nvenc && value.bFrames > 4) issue('bFrames', 'NVIDIA 编码器最多支持 4 个连续 B 帧。')
  if (nvenc && value.lookaheadFrames > 32) issue('lookaheadFrames', 'NVIDIA 前瞻最多支持 32 帧。')
  const hevc = value.encoder === 'hevc_nvenc' || value.encoder === 'libx265'
  const profiles = hevc ? ['auto', 'main', 'main10'] : ['auto', 'baseline', 'main', 'high', 'high10']
  if (!profiles.includes(value.profile)) issue('profile', 'Profile 与视频编码格式不匹配。')
  if (value.profile !== 'auto' && value.tenBit !== ['high10', 'main10'].includes(value.profile)) issue('profile', 'Profile 与输出位深不匹配。')
  if (value.profile === 'baseline' && value.bFrames > 0) issue('bFrames', 'Baseline Profile 不支持 B 帧。')
  if (!videoEditExportLevels(hevc ? 'hevc' : 'avc').includes(value.level)) issue('level', 'Level 与视频编码格式不匹配。')
})
export type VideoEditExportEncoding = z.infer<typeof videoEditExportEncodingSchema>
export interface VideoEditExportEncoderCapability { supported: boolean; tenBit: boolean; reason?: string }
export interface VideoEditExportCapabilities { cuda: boolean; encoders: Record<VideoEditExportEncoding['encoder'], VideoEditExportEncoderCapability> }

export function videoEditExportEncoderSupportsSize(encoder: VideoEditExportEncoding['encoder'], width: number, height: number): boolean {
  const maximum = encoder === 'h264_nvenc' ? 4096 : encoder === 'hevc_nvenc' ? 8192 : Infinity
  return width <= maximum && height <= maximum
}

/** 内置快照不依赖本机硬件；提交预设时才按能力换成同格式的硬件模板。 */
export function videoEditExportQualityEncoding(codec: 'avc' | 'hevc', tier: Exclude<VideoEditExportQuality, 'bitrate'>, encoder?: VideoEditExportEncoding['encoder']): VideoEditExportEncoding {
  const selected = encoder ?? (codec === 'avc' ? 'libx264' : 'libx265')
  const nvenc = selected.endsWith('_nvenc')
  const quality = (nvenc ? 28 : 20) + (tier === 'high' ? 4 : tier === 'standard' ? 8 : 0)
  return { encoder: selected, rateControl: 'quality', quality,
    maxBitrateMbps: 0, bufferMbps: 0, preset: nvenc ? 'p6' : 'medium', profile: 'auto', level: 'auto', keyframeSeconds: 2,
    bFrames: 3, lookaheadFrames: nvenc ? 20 : 40, spatialAq: true, temporalAq: false, colorRange: 'limited', colorMatrix: 'bt709', tenBit: false }
}
export function applyVideoEditExportQuality(settings: VideoEditExportSettings, tier: VideoEditExportQuality, capabilities: VideoEditExportCapabilities): VideoEditExportSettings {
  if (tier === 'bitrate') return { ...settings, encoding: undefined }
  const candidates = settings.codec === 'avc' ? ['h264_nvenc', 'libx264'] as const : ['hevc_nvenc', 'libx265'] as const
  const encoder = candidates.find(value => capabilities.encoders[value].supported && videoEditExportEncoderSupportsSize(value, settings.width, settings.height))
  if (!encoder) throw new Error(`此设备没有可用的 ${settings.codec === 'avc' ? 'H.264' : 'H.265'} 编码器。`)
  return { ...settings, encoding: videoEditExportQualityEncoding(settings.codec, tier, encoder) }
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]))
  return value
}
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))
export function videoEditExportQualityOf(settings: VideoEditExportSettings): VideoEditExportQuality | 'custom' {
  if (!settings.encoding) return 'bitrate'
  return (['visually_lossless', 'high', 'standard'] as const).find(tier => equal(settings.encoding, videoEditExportQualityEncoding(settings.codec, tier, settings.encoding!.encoder))) ?? 'custom'
}
/** 比较基线与当前设置须经过相同的序列解析和设备适配，避免把自动适配标成用户修改。 */
export function videoEditExportPresetModified(settings: VideoEditExportSettings, preset: VideoEditExportPreset): boolean {
  const normalize = (value: VideoEditExportSettings): unknown => ({ ...value, usePreviews: value.usePreviews ?? false, renderAtOutputResolution: value.renderAtOutputResolution ?? true })
  return !equal(normalize(settings), normalize(preset.settings))
}
export function videoEditExportChangedFields(settings: VideoEditExportSettings, preset: VideoEditExportPreset): Array<keyof VideoEditExportEncoding> {
  return Object.keys(videoEditExportEncodingSchema.shape).filter(key => !equal(settings.encoding?.[key as keyof VideoEditExportEncoding], preset.settings.encoding?.[key as keyof VideoEditExportEncoding])) as Array<keyof VideoEditExportEncoding>
}
export function videoEditExportIntermediateSettings(settings: VideoEditExportSettings): VideoEditExportSettings {
  if (!settings.videoEnabled || !settings.encoding) return settings
  // 每像素每帧约 3 bit，1080p30 为 187 Mbps；与交付码率解耦，不让低码率预设污染中间画面。
  return { ...settings, codec: Math.max(settings.width, settings.height) > 4096 ? 'hevc' : 'avc', encoding: undefined, videoBitrateMbps: Math.min(200, Math.max(80, settings.width * settings.height * (settings.fps ?? 30) * 3 / 1_000_000)), bitrateMode: 'vbr', keyframeInterval: 1 }
}
