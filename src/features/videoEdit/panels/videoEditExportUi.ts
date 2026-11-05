import { videoEditExportLevels, type VideoEditExportEncoding, type VideoEditExportQuality } from '@/core/videoEdit/exportEncoding'
import type { videoEditExportQueue } from '../application/videoEditExportQueue'

type Encoding = VideoEditExportEncoding

export const VIDEO_EDIT_EXPORT_QUALITY_LABELS: Record<VideoEditExportQuality | 'custom', string> = { visually_lossless: '视觉无损', high: '高', standard: '标准', bitrate: '指定码率', custom: '自定义' }

export const NVENC_PRESETS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'] as const
export const SOFTWARE_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo'] as const
// 硬件 p6 与软件 medium 是各自的默认档，两边按同一相对位置互换；软件更慢的几档都对应硬件最精细的 p7。
const SOFTWARE_FOR_NVENC: Record<typeof NVENC_PRESETS[number], typeof SOFTWARE_PRESETS[number]> = { p1: 'ultrafast', p2: 'superfast', p3: 'veryfast', p4: 'faster', p5: 'fast', p6: 'medium', p7: 'slow' }
const NVENC_FOR_SOFTWARE = (preset: string): typeof NVENC_PRESETS[number] => (Object.entries(SOFTWARE_FOR_NVENC).find(([, value]) => value === preset)?.[0] as typeof NVENC_PRESETS[number] | undefined) ?? 'p7'
// 同样接近视觉无损时，硬件 CQ 比软件 CRF 高 8（与画质档模板一致）。
const NVENC_QUALITY_OFFSET = 8
export const nvencOf = (encoder: Encoding['encoder']): boolean => encoder.endsWith('_nvenc')
const tenBitProfile = (codec: 'avc' | 'hevc', tenBit: boolean): Encoding['profile'] => codec === 'hevc' ? tenBit ? 'main10' : 'main' : tenBit ? 'high10' : 'high'

/** 一项改动带出的连带调整：保持参数组合始终可被编码器接受，用户不必先改别处再回来。 */
export function adjustVideoEditExportEncoding(previous: Encoding, next: Encoding, codec: 'avc' | 'hevc'): Encoding {
  const value = { ...next }
  if (nvencOf(previous.encoder) !== nvencOf(value.encoder)) {
    const toNvenc = nvencOf(value.encoder)
    value.preset = toNvenc ? NVENC_FOR_SOFTWARE(value.preset) : SOFTWARE_FOR_NVENC[value.preset as typeof NVENC_PRESETS[number]] ?? 'medium'
    value.quality = Math.min(51, Math.max(toNvenc ? 1 : 0, value.quality + (toNvenc ? NVENC_QUALITY_OFFSET : -NVENC_QUALITY_OFFSET)))
    if (toNvenc) { value.bFrames = Math.min(4, value.bFrames); value.lookaheadFrames = Math.min(32, value.lookaheadFrames) }
    else value.temporalAq = false
  }
  if (previous.tenBit !== value.tenBit && value.profile !== 'auto') value.profile = tenBitProfile(codec, value.tenBit)
  if (value.profile === 'baseline') value.bFrames = 0
  if (!videoEditExportLevels(codec).includes(value.level)) value.level = 'auto'
  return value
}

type ExportJob = ReturnType<typeof videoEditExportQueue.list>[number]
const clamp = (value: number): number => Math.max(0, Math.min(1, value))
/** 按画质压制的视频分两段：先合成画面，再由编码器压制；其余导出只有一段，返回 undefined。 */
export function videoEditExportStages(job: ExportJob): Array<{ label: '合成' | '压制'; progress: number }> | undefined {
  if (!job.settings.videoEnabled || !job.settings.encoding || !job.task) return undefined
  const done = job.state === 'completed'
  return [{ label: '合成', progress: done ? 1 : clamp(job.task.compositionProgress ?? 0) }, { label: '压制', progress: done ? 1 : clamp(job.task.compressionProgress ?? 0) }]
}

/**
 * 界面重新加载前就结束的项留在导出队列列表里，不再弹窗挡住界面。被重新加载打断的（interrupted）要弹：
 * 用户还不知道它停了。恢复后重新跑过的项有 startedAt，照常弹。
 */
export function endedBeforeReload(job: { restored?: boolean; startedAt?: number; state: string }): boolean {
  return !!job.restored && job.startedAt === undefined && (job.state === 'completed' || job.state === 'cancelled' || job.state === 'failed')
}
