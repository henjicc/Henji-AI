import type { VideoEditMedia } from '@/core/videoEdit/document'
import { VIDEO_EDIT_FRAME_RATES, videoEditFps, type VideoEditRatio } from '@/core/videoEdit/time'
import { getPlatform } from '@/platform/runtime'
import type { NativeMediaProbe, NativeMediaProbeOutcome, NativeMediaRational, NativeMediaStream, NativeVideoDecoderStatus } from '@/platform/contracts/videoDecoder'
import { chooseVideoEditDecodeBackend, VIDEO_EDIT_NATIVE_PLAYBACK_READY, VIDEO_EDIT_NATIVE_PRIMARY, type VideoEditDecodeBackend, type VideoEditDecodeSupport } from '../engine/videoEditFrameSource'

/**
 * Media inspection: what each decoder can do for a file, which one decodes it, and where its metadata comes from.
 * The native probe contract (`@/platform/contracts/videoDecoderTypes`) mirrors the native service's probe result,
 * reduced to what the edit workspace reads, plus whether the native service has a decoder for each stream.
 */
export type VideoEditNativeRational = NativeMediaRational
export type VideoEditNativeStream = NativeMediaStream
export type VideoEditNativeProbe = NativeMediaProbe
export type VideoEditNativeProbeOutcome = NativeMediaProbeOutcome
interface BrowserStream { codec: string | null; decodable: boolean }
export type VideoEditInspectedFields = Pick<VideoEditMedia, 'kind' | 'hasAudio' | 'width' | 'height' | 'durationSeconds' | 'frameRate' | 'frameRateMode'>
/** Chromium's view of the file (mediabunny + WebCodecs). `media` is read only when every stream decodes. */
export type VideoEditBrowserInspection = { status: 'read'; video?: BrowserStream; audio?: BrowserStream; media?: VideoEditInspectedFields } | { status: 'unreadable'; error: unknown }

let status: Promise<NativeVideoDecoderStatus> | undefined
/** Native probing entry (the platform's native decoder service); replaced with spies in tests. */
export const videoEditNativeMediaProbe = {
  async probe(path: string, signal?: AbortSignal): Promise<VideoEditNativeProbeOutcome> { return getPlatform().videoDecoder.probe(path, signal) },
  /** The developer diagnostic `HENJI_VIDEO_DECODER`, fixed for the session; never shown in the interface. */
  async forcedBackend(): Promise<VideoEditDecodeBackend | undefined> {
    try {
      status ??= getPlatform().videoDecoder.status()
      return (await status).forcedBackend ?? undefined
    } catch { status = undefined; return undefined }
  },
}

export function matchVideoEditFrameRate(fps: number): VideoEditRatio | undefined {
  return Number.isFinite(fps) && fps > 0 ? VIDEO_EDIT_FRAME_RATES.find(rate => Math.abs(videoEditFps(rate) / fps - 1) < 0.001) : undefined
}
function nativeStreams(probe: VideoEditNativeProbe): { video?: VideoEditNativeStream; audio?: VideoEditNativeStream } {
  const video = probe.streams.find(stream => stream.index === probe.primaryVideoStreamIndex && stream.kind === 'video' && stream.video && !stream.isAttachedPicture)
  const audio = probe.streams.find(stream => stream.index === probe.primaryAudioStreamIndex && stream.kind === 'audio')
  return { ...(video ? { video } : {}), ...(audio ? { audio } : {}) }
}
const fps = (rate: VideoEditNativeRational | null): number | undefined => rate && rate.num > 0 && rate.den > 0 ? rate.num / rate.den : undefined
/**
 * Metadata from the native probe. Duration is the absolute end time. The container's declared average and real (base) frame rates agree for constant
 * frame rate material; when they differ the file is treated as variable, as a sampled browser probe would.
 */
export function videoEditFieldsFromNativeProbe(probe: VideoEditNativeProbe): VideoEditInspectedFields {
  const { video, audio } = nativeStreams(probe)
  // Absolute end time (start + duration) of the latest picture or sound stream, the browser probe's measure: a
  // timeline starting after zero (MPEG program streams) keeps its tail, and timecode or data tracks do not count.
  // The container's own span is only a fallback when no stream reports a duration.
  const end = (start: number | null | undefined, duration: number | null | undefined): number[] => typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? [duration + (typeof start === 'number' && Number.isFinite(start) && start > 0 ? start : 0)] : []
  const streamEnds = probe.streams.filter(stream => (stream.kind === 'video' && !stream.isAttachedPicture) || stream.kind === 'audio').flatMap(stream => end(stream.startTimeSeconds, stream.durationSeconds))
  const durationSeconds = Math.max(0, ...(streamEnds.length ? streamEnds : end(probe.container.startTimeSeconds, probe.container.durationSeconds)))
  if (!video?.video) return { kind: 'audio', hasAudio: Boolean(audio), width: 0, height: 0, durationSeconds }
  const { width, height, rotationDegrees, avgFrameRate, realFrameRate } = video.video
  const quarterTurn = Math.abs(Math.round(rotationDegrees ?? 0)) % 180 === 90
  const average = fps(avgFrameRate); const real = fps(realFrameRate)
  const rate = matchVideoEditFrameRate(average ?? real ?? NaN)
  const frameRateMode = average !== undefined && real !== undefined ? Math.abs(average / real - 1) < 0.001 ? 'sampled-constant' as const : 'variable' as const : 'unknown' as const
  return { kind: 'video', hasAudio: Boolean(audio), width: quarterTurn ? height : width, height: quarterTurn ? width : height, durationSeconds, ...(rate ? { frameRate: rate } : {}), frameRateMode }
}

const CODEC_NAMES: Record<string, string> = {
  h264: 'H.264', avc: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', prores: 'Apple ProRes', cfhd: 'GoPro CineForm',
  mpeg2video: 'MPEG-2', mpeg1video: 'MPEG-1', mpeg4: 'MPEG-4 Part 2', mjpeg: 'Motion JPEG', dvvideo: 'DV',
  aac: 'AAC', mp3: 'MP3', mp2: 'MPEG 音频', ac3: 'AC-3', eac3: 'E-AC-3', dts: 'DTS', truehd: 'Dolby TrueHD', flac: 'FLAC', opus: 'Opus', vorbis: 'Vorbis', alac: 'ALAC',
}
function codecName(codec: string | null): string {
  if (!codec) return '未知编码'
  if (/^pcm/i.test(codec)) return 'PCM'
  return CODEC_NAMES[codec.toLowerCase()] ?? codec.toUpperCase()
}
/** A user-facing format description such as "Apple ProRes 4444，12 位 4:4:4，带透明". */
export function videoEditNativeFormatLabel(stream: VideoEditNativeStream): string {
  const dnxhr = stream.codec === 'dnxhd' && stream.profile?.toUpperCase().startsWith('DNXHR')
  const name = stream.codec === 'dnxhd' ? dnxhr ? `Avid DNxHR ${stream.profile!.slice(5).trim()}`.trim() : 'Avid DNxHD' : `${codecName(stream.codec)}${stream.profile && stream.profile !== 'unknown' ? ` ${stream.profile}` : ''}`
  const video = stream.video
  const detail = video ? [video.bitDepth && video.chromaSubsampling ? `${video.bitDepth} 位 ${video.chromaSubsampling}` : '', video.hasAlpha ? '带透明' : ''].filter(Boolean) : []
  return [name, ...detail].join('，')
}
function extensionOf(path: string): string { return path.split(/[\\/]/).at(-1)?.match(/\.([a-z0-9]+)$/i)?.[1]?.toUpperCase() ?? '' }

/**
 * The single inspection decision. `backend` is the decoder that will actually play the file, chosen by
 * `chooseVideoEditDecodeBackend`; `nativeDecodes` only reports what the native probe found. Metadata comes from the
 * browser whenever it decodes the whole file (its frame clock and duration are what existing projects recorded),
 * otherwise from the native probe. Throws a user-language error naming the format and the reason when nothing
 * decodes the file. Never names a decoder implementation.
 * `nativePlayback` is the switch for native playback: without it (`VIDEO_EDIT_NATIVE_PLAYBACK_READY`) native is never a
 * playback backend (a forced `native` waits for it too), and files only the native decoder reads are refused with
 * their format, so nothing is imported that the program monitor cannot show. `nativePrimary` is the renderer's
 * policy for files both decoders read (`VIDEO_EDIT_NATIVE_PRIMARY`), so the logged backend is the one that plays.
 */
export function resolveVideoEditMediaInspection(path: string, native: VideoEditNativeProbeOutcome, browser: VideoEditBrowserInspection, forced?: VideoEditDecodeBackend, nativePlayback = VIDEO_EDIT_NATIVE_PLAYBACK_READY, nativePrimary = VIDEO_EDIT_NATIVE_PRIMARY): { backend: VideoEditDecodeBackend; nativeDecodes: boolean; fields: VideoEditInspectedFields } {
  const streams = native.status === 'probed' ? nativeStreams(native.probe) : undefined
  const nativeSupport: VideoEditDecodeSupport['native'] = !streams ? 'unavailable' : (streams.video || streams.audio) && (streams.video?.decodable ?? true) && (streams.audio?.decodable ?? true) ? 'decodes' : 'cannot-decode'
  const nativeDecodes = nativeSupport === 'decodes'
  const support: VideoEditDecodeSupport = {
    native: nativePlayback ? nativeSupport : 'unavailable',
    browser: browser.status === 'read' && browser.media ? 'decodes' : 'cannot-decode',
  }
  const backend = chooseVideoEditDecodeBackend(support, nativePlayback || forced === 'browser' ? forced : undefined, nativePrimary)
  if (backend && browser.status === 'read' && browser.media) return { backend, nativeDecodes, fields: browser.media }
  if (backend && native.status === 'probed') return { backend, nativeDecodes, fields: videoEditFieldsFromNativeProbe(native.probe) }
  if (!nativePlayback && nativeDecodes && streams && forced !== 'browser') {
    const browserVideoFails = browser.status === 'unreadable' || browser.video?.decodable === false
    const blocked = streams.video && (browserVideoFails || !streams.audio) ? streams.video : streams.audio ?? streams.video!
    throw new Error(blocked === streams.video ? `剪辑暂不能播放此视频格式（${videoEditNativeFormatLabel(blocked)}），请先转为 H.264 视频后再导入。` : `剪辑暂不能播放此声音格式（${videoEditNativeFormatLabel(blocked)}），请先转为 AAC 或 PCM 声音后再导入。`)
  }
  const cause = native.status === 'unreadable' ? new Error(native.message) : browser.status === 'unreadable' ? browser.error : undefined
  throw new Error(undecodableMessage(path, streams, browser), cause === undefined ? undefined : { cause })
}
function undecodableMessage(path: string, streams: ReturnType<typeof nativeStreams> | undefined, browser: VideoEditBrowserInspection): string {
  const retry = '可重启软件后重试，或先转为 H.264 视频后再导入。'
  if (streams) {
    if (!streams.video && !streams.audio) return '文件没有可用的音视频轨道。'
    if (streams.video && !streams.video.decodable) return `无法解码此视频的编码格式（${videoEditNativeFormatLabel(streams.video)}），请先转为 H.264 视频后再导入。`
    if (streams.audio && !streams.audio.decodable) return `无法解码此文件的声音编码（${videoEditNativeFormatLabel(streams.audio)}），请先转为 AAC 或 PCM 声音后再导入。`
  }
  if (browser.status === 'read') {
    if (!browser.video && !browser.audio) return '文件没有可用的音视频轨道。'
    if (browser.video && !browser.video.decodable) return `当前设备无法解码此视频（${browser.video.codec ? codecName(browser.video.codec) : extensionOf(path) ? `${extensionOf(path)} 文件中的视频编码` : '未知视频编码'}）。${retry}`
    if (browser.audio && !browser.audio.decodable) return `当前设备无法解码此文件的声音（${codecName(browser.audio.codec)}）。${retry}`
  }
  const extension = extensionOf(path)
  return `当前无法读取${extension ? `此 ${extension} 文件` : '此文件'}，文件可能已损坏或格式暂不支持。${retry}`
}
