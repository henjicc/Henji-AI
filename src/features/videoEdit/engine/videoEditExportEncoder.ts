import type { VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import { createLogger } from '@/core/logging'
import { videoEditExportAudioEncoderConfig, videoEditExportVideoEncoderConfig, type VideoEditExportAudioEncoderSpec, type VideoEditExportEncoderSpec } from './videoEditExportEncoderConfig'
export { videoEditExportAudioOptions, videoEditExportVideoOptions } from './videoEditExportEncoderConfig'
export type { VideoEditExportAudioEncoderSpec, VideoEditExportEncoderSpec } from './videoEditExportEncoderConfig'

const logger = createLogger('features.videoEdit.exportEncoder')
export const VIDEO_EDIT_EXPORT_AUDIO_BITRATES = [320, 256, 192, 160, 128, 96, 64] as const
type AudioSettings = Pick<VideoEditExportSettings, 'audioEnabled' | 'audioCodec' | 'sampleRate' | 'channels' | 'audioBitrateKbps'>
const nativeSupportCache = new WeakMap<object, Map<string, Promise<boolean>>>()
type ProbePhase = 'probe' | 'adapt' | 'strict'
interface ProbeTrace { phase: ProbePhase; candidateKey?: string }
/** The only native support predicate: cache the complete config, sharing concurrent probes.
 * Failed native calls are not cached, so a transient device failure can be retried.
 */
async function supportsEncoderConfig<C extends VideoEncoderConfig | AudioEncoderConfig>(encoder: { isConfigSupported: (config: C) => Promise<{ supported?: boolean }> } | undefined, config: C, trace: ProbeTrace = { phase: 'probe' }): Promise<boolean> {
  if (!encoder) {
    logger.debug('导出原生编码探测', { event: 'video_edit.export.probe', context: { ...trace, configuration: config, cacheHit: false, supported: false, encoderAvailable: false } })
    return false
  }
  let cache = nativeSupportCache.get(encoder)
  if (!cache) { cache = new Map(); nativeSupportCache.set(encoder, cache) }
  const key = JSON.stringify(config)
  let pending = cache.get(key)
  const cacheHit = pending !== undefined
  if (!pending) {
    pending = encoder.isConfigSupported(config).then(result => result.supported === true).catch(error => { cache.delete(key); throw error })
    cache.set(key, pending)
  }
  try {
    const supported = await pending
    logger.debug('导出原生编码探测', { event: 'video_edit.export.probe', context: { ...trace, configuration: config, cacheHit, supported, encoderAvailable: true } })
    return supported
  } catch (error) {
    logger.debug('导出原生编码探测失败', { event: 'video_edit.export.probe', error, context: { ...trace, configuration: config, cacheHit, supported: false, encoderAvailable: true } })
    throw error
  }
}
/** PCM is encoded by Mediabunny itself; it does not use AudioEncoder. */
export async function canEncodeVideoEditExportAudio(spec: VideoEditExportAudioEncoderSpec, trace?: ProbeTrace): Promise<boolean> {
  if (spec.codec === 'pcm-s24') return Number.isInteger(spec.sampleRate) && spec.sampleRate > 0 && Number.isInteger(spec.numberOfChannels) && spec.numberOfChannels > 0
  return supportsEncoderConfig(typeof AudioEncoder === 'undefined' ? undefined : AudioEncoder, videoEditExportAudioEncoderConfig(spec), trace)
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

export async function canEncodeVideoEditExport(spec: VideoEditExportEncoderSpec & { codec: 'avc' | 'hevc' }, trace?: ProbeTrace): Promise<boolean> {
  // H.264/HEVC require even coded dimensions in Mediabunny's actual encoder path.
  if (![spec.width, spec.height].every(value => Number.isInteger(value) && value > 0 && value % 2 === 0)) return false
  return supportsEncoderConfig(typeof VideoEncoder === 'undefined' ? undefined : VideoEncoder, videoEditExportVideoEncoderConfig(spec), trace)
}

/** Resolved settings only: the same configuration identifies panel results and submission checks.
 * Keyframe spacing is scheduled by Mediabunny rather than a native encoder field, but must still
 * invalidate the panel's configuration snapshot; it is not a VideoEncoderConfig field.
 */
export function videoEditExportProbeKey(settings: VideoEditExportSettings): string {
  return JSON.stringify({ format: settings.format, videoEnabled: settings.videoEnabled,
    video: videoEditExportVideoEncoderConfig({ ...settings, frameRate: settings.fps ?? 0, bitrate: Math.round(settings.videoBitrateMbps * 1_000_000) }), keyframeInterval: settings.keyframeInterval,
    audioEnabled: settings.audioEnabled, audioCodec: settings.audioCodec,
    audio: videoEditExportAudioEncoderConfig({ codec: settings.audioCodec === 'wav' ? 'pcm-s24' : 'aac', sampleRate: settings.sampleRate, numberOfChannels: settings.channels, bitrate: settings.audioBitrateKbps * 1000 }) })
}
export interface VideoEditExportSupport { supported: boolean; videoSupported: boolean; audioSupported: boolean; reason: string }
/** One complete probe for the panel, queue, direct pipeline and assistant. No implicit replacement. */
export async function probeVideoEditExport(settings: VideoEditExportSettings, phase: ProbePhase = 'probe'): Promise<VideoEditExportSupport> {
  try {
    if (settings.fps === null) throw new Error('请先解析序列帧率。')
    const trace = { phase, candidateKey: videoEditExportProbeKey(settings) }
    const videoSupported = !settings.videoEnabled || await canEncodeVideoEditExport({ width: settings.width, height: settings.height, frameRate: settings.fps,
      bitrate: Math.round(settings.videoBitrateMbps * 1_000_000), codec: settings.codec, bitrateMode: settings.bitrateMode, encoderPreference: settings.encoderPreference, keyframeInterval: settings.keyframeInterval }, trace)
    const audioSupported = !settings.audioEnabled || await canEncodeVideoEditExportAudio({ codec: settings.audioCodec === 'wav' ? 'pcm-s24' : 'aac',
      sampleRate: settings.sampleRate, numberOfChannels: settings.channels, ...(settings.audioCodec === 'aac' ? { bitrate: settings.audioBitrateKbps * 1000 } : {}) }, trace)
    const reason = !videoSupported ? `当前设备不支持所选编码设置（${settings.codec === 'avc' ? 'H.264' : 'HEVC'} · ${settings.width} × ${settings.height} · ${Number(settings.fps.toFixed(3))} 帧）。请尝试其他编码、性能或码率模式，或降低规格。`
      : !audioSupported ? settings.audioCodec === 'aac' ? videoEditExportAudioUnsupportedMessage(settings, await probeVideoEditExportAudioBitrates(settings)) : '此设备不支持所选 WAV 声音设置，请调整采样率或声道。' : ''
    const result = { supported: videoSupported && audioSupported, videoSupported, audioSupported, reason }
    logger.debug('导出候选编码探测完成', { event: 'video_edit.export.probe', context: { ...trace, ...result } })
    return result
  } catch (error) {
    logger.warn('导出编码支持检查失败', { event: 'video_edit.export.encoder_probe_failed', error, context: { phase, configuration: videoEditExportProbeKey(settings) } })
    return { supported: false, videoSupported: false, audioSupported: false, reason: '无法检查此设备的编码支持，请重试或调整导出设置。' }
  }
}
export async function assertVideoEditExportSupported(settings: VideoEditExportSettings): Promise<void> {
  const result = await probeVideoEditExport(settings, 'strict')
  if (!result.supported) {
    logger.warn('导出编码配置未接受', { event: 'video_edit.export.encoder_rejected', context: { configuration: videoEditExportProbeKey(settings), reason: result.reason } })
    throw new Error(result.reason)
  }
}
/** Device adaptation is reserved for presets; explicit settings always use the strict probe above. */
export async function adaptVideoEditExportPreset(settings: VideoEditExportSettings): Promise<VideoEditExportSettings> {
  if ((await probeVideoEditExport(settings, 'adapt')).supported) return settings
  let candidate = settings
  if (candidate.audioEnabled && candidate.audioCodec === 'aac') {
    const supported = await probeVideoEditExportAudioBitrates(candidate)
    if (!supported[candidate.audioBitrateKbps]) {
      const lower = Object.keys(supported).map(Number).filter(value => value < candidate.audioBitrateKbps && supported[value])
      if (lower.length) candidate = { ...candidate, audioBitrateKbps: Math.max(...lower) }
    }
  }
  if (!candidate.videoEnabled) { await assertVideoEditExportSupported(candidate); return candidate }
  // Keep the preset's requested mode first, then its alternative; keep output geometry intact.
  const modes = [candidate.bitrateMode, candidate.bitrateMode === 'vbr' ? 'cbr' : 'vbr'] as const
  const recommended = candidate.width * candidate.height >= 7680 * 4320 ? 80 : candidate.width * candidate.height >= 3840 * 2160 ? 45 : candidate.width * candidate.height >= 1920 * 1080 ? 12 : 6
  for (const videoBitrateMbps of [...new Set([candidate.videoBitrateMbps, Math.min(candidate.videoBitrateMbps, recommended)])]) {
    for (const codec of ['avc', 'hevc'] as const) for (const encoderPreference of ['hardware', 'software'] as const) for (const bitrateMode of modes) {
      const next = { ...candidate, codec, encoderPreference, bitrateMode, videoBitrateMbps }
      if ((await probeVideoEditExport(next, 'adapt')).supported) return next
    }
  }
  await assertVideoEditExportSupported(candidate)
  return candidate
}
/** 探测实际输出规格；大画幅优先 HEVC，其他规格优先 H.264。 */
export async function selectVideoEditExportEncoder(spec: VideoEditExportEncoderSpec): Promise<'avc' | 'hevc'> {
  const codecs = spec.codec ? [spec.codec] : Math.max(spec.width, spec.height) > 4096 ? ['hevc', 'avc'] as const : ['avc', 'hevc'] as const
  for (const codec of codecs) if (await canEncodeVideoEditExport({ ...spec, codec })) return codec
  if (spec.codec) throw new Error(`当前设备不支持 ${spec.codec === 'avc' ? 'H.264' : 'HEVC'} · ${spec.width} × ${spec.height} · ${Number(spec.frameRate.toFixed(3))} 帧的所选编码设置。${spec.codec === 'avc' ? '请尝试 HEVC，或' : '请'}降低规格、切换性能或码率模式。`)
  throw new Error(`当前设备无法导出 ${spec.width} × ${spec.height} · ${Number(spec.frameRate.toFixed(3))} 帧视频。请降低导出分辨率或帧率后重试。`)
}
