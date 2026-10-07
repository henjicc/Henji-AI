import { canEncodeAudio, canEncodeVideo } from 'mediabunny'
import type { VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.exportEncoder')
export const VIDEO_EDIT_EXPORT_AUDIO_BITRATES = [320, 256, 192, 160, 128, 96] as const
type AudioSettings = Pick<VideoEditExportSettings, 'audioEnabled' | 'audioCodec' | 'sampleRate' | 'channels' | 'audioBitrateKbps'>
export interface VideoEditExportAudioEncoderSpec { codec: 'aac' | 'pcm-s24'; sampleRate: number; numberOfChannels: number; bitrate?: number }
/** Mediabunny caches the full encoder configuration, including concurrent probes, and handles PCM itself. */
export async function canEncodeVideoEditExportAudio(spec: VideoEditExportAudioEncoderSpec): Promise<boolean> {
  const { codec, ...options } = spec
  return canEncodeAudio(codec, options)
}
export async function probeVideoEditExportAudioBitrates(settings: AudioSettings): Promise<Record<number, boolean>> {
  const bitrates = [...new Set([settings.audioBitrateKbps, ...VIDEO_EDIT_EXPORT_AUDIO_BITRATES])]
  const values = await Promise.all(bitrates.map(async value => [value, await canEncodeVideoEditExportAudio({ codec: 'aac', sampleRate: settings.sampleRate, numberOfChannels: settings.channels, bitrate: value * 1000 })] as const))
  return Object.fromEntries(values)
}
export function videoEditExportAudioUnsupportedMessage(settings: AudioSettings, supported: Record<number, boolean>): string {
  const lower = Object.keys(supported).map(Number).filter(value => supported[value] && value < settings.audioBitrateKbps)
  return `此设备的 AAC 编码不支持 ${settings.audioBitrateKbps} kbps（${settings.sampleRate / 1000} kHz，${settings.channels === 2 ? '立体声' : '单声道'}），${lower.length ? `请改用 ${Math.max(...lower)} kbps 或更低。` : '请调整采样率、声道或改用 WAV。'}`
}
/** Shared submission check for the panel, queue, assistant and workspace transfer. */
export async function assertVideoEditExportAudioSupported(settings: AudioSettings): Promise<void> {
  if (!settings.audioEnabled) return
  try {
    const codec = settings.audioCodec === 'wav' ? 'pcm-s24' : 'aac'
    if (await canEncodeVideoEditExportAudio({ codec, sampleRate: settings.sampleRate, numberOfChannels: settings.channels, ...(codec === 'aac' ? { bitrate: settings.audioBitrateKbps * 1000 } : {}) })) return
    const message = codec === 'aac' ? videoEditExportAudioUnsupportedMessage(settings, await probeVideoEditExportAudioBitrates(settings)) : '此设备不支持所选 WAV 声音设置，请调整采样率或声道。'
    throw new Error(message)
  } catch (error) {
    logger.warn('导出音频配置未接受', { event: 'video_edit.export.audio_rejected', error, context: { ...settings } })
    if (error instanceof Error && error.message.startsWith('此设备')) throw error
    throw new Error('无法检查此设备的音频编码支持，请重试或改用 WAV。', { cause: error })
  }
}
/** Keep unexpected native AAC rejection out of UI/task errors; callers log the original error. */
export function videoEditExportAudioUserError(error: unknown, settings: AudioSettings): unknown {
  if (settings.audioEnabled && settings.audioCodec === 'aac' && error instanceof Error && /mp4a\.[\s\S]*not supported/i.test(error.message)) {
    return new Error(videoEditExportAudioUnsupportedMessage(settings, {}), { cause: error })
  }
  return error
}

export interface VideoEditExportEncoderSpec { width: number; height: number; frameRate: number; bitrate: number; codec?: 'avc' | 'hevc'; bitrateMode?: 'vbr' | 'cbr'; encoderPreference?: 'hardware' | 'software' }
export function videoEditExportVideoOptions(settings: Pick<VideoEditExportSettings, 'codec' | 'videoBitrateMbps' | 'bitrateMode' | 'encoderPreference' | 'keyframeInterval'>) {
  return { codec: settings.codec, bitrate: Math.round(settings.videoBitrateMbps * 1_000_000), bitrateMode: settings.bitrateMode === 'cbr' ? 'constant' as const : 'variable' as const,
    hardwareAcceleration: settings.encoderPreference === 'software' ? 'prefer-software' as const : 'prefer-hardware' as const,
    ...(settings.keyframeInterval === 'auto' ? {} : { keyFrameInterval: settings.keyframeInterval }) }
}
export async function canEncodeVideoEditExport(spec: VideoEditExportEncoderSpec & { codec: 'avc' | 'hevc' }): Promise<boolean> {
  const { codec, bitrateMode, encoderPreference, ...geometry } = spec
  return canEncodeVideo(codec, { ...geometry, ...(bitrateMode ? { bitrateMode: bitrateMode === 'cbr' ? 'constant' : 'variable' } : {}), ...(encoderPreference ? { hardwareAcceleration: encoderPreference === 'software' ? 'prefer-software' : 'prefer-hardware' } : {}) })
}
/** 探测实际输出规格；大画幅优先 HEVC，其他规格优先 H.264。 */
export async function selectVideoEditExportEncoder(spec: VideoEditExportEncoderSpec): Promise<'avc' | 'hevc'> {
  const codecs = spec.codec ? [spec.codec] : Math.max(spec.width, spec.height) > 4096 ? ['hevc', 'avc'] as const : ['avc', 'hevc'] as const
  for (const codec of codecs) if (await canEncodeVideoEditExport({ ...spec, codec })) return codec
  if (spec.codec) throw new Error(`当前设备不支持 ${spec.codec === 'avc' ? 'H.264' : 'HEVC'} · ${spec.width} × ${spec.height} · ${Number(spec.frameRate.toFixed(3))} 帧的所选编码设置。${spec.codec === 'avc' ? '请尝试 HEVC，或' : '请'}降低规格、切换性能或码率模式。`)
  throw new Error(`当前设备无法导出 ${spec.width} × ${spec.height} · ${Number(spec.frameRate.toFixed(3))} 帧视频。请降低导出分辨率或帧率后重试。`)
}
