import type { AudioEncodingConfig, VideoEncodingConfig } from 'mediabunny'
import type { VideoEditExportSettings } from '@/core/videoEdit/exportPresets'

/* Codec level data and selection adapted from Mediabunny 1.61.0 src/codec.ts.
 * Copyright (c) 2026-present, Vanilagy and contributors. MPL-2.0:
 * https://mozilla.org/MPL/2.0/
 * Throughput limits follow H.264 Table A-1 / H.265 Table A.6 (also listed at
 * https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/h264_levels.c and
 * https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/h265_profile_level.c).
 * Mediabunny's level selection omits frame rate; include it here for both codecs.
 * Its config builders are private; use fullCodecString to give probing and encoding
 * the same profile/level instead of depending on two independently resolved defaults.
 */
const avcLevels = [
  // Maximum macroblocks/frame, bitrate, level_idc, macroblocks/second.
  [99, 64000, 10, 1485], [396, 192000, 11, 3000], [396, 384000, 12, 6000], [396, 768000, 13, 11880],
  [396, 2000000, 20, 11880], [792, 4000000, 21, 19800], [1620, 4000000, 22, 20250], [1620, 10000000, 30, 40500],
  [3600, 14000000, 31, 108000], [5120, 20000000, 32, 216000], [8192, 20000000, 40, 245760], [8192, 50000000, 41, 245760],
  [8704, 50000000, 42, 522240], [22080, 135000000, 50, 589824], [36864, 240000000, 51, 983040], [36864, 240000000, 52, 2073600],
  [139264, 240000000, 60, 4177920], [139264, 480000000, 61, 8355840], [139264, 800000000, 62, 16711680],
] as const
const hevcLevels = [
  // Maximum luma samples/frame, bitrate, tier, level_idc, luma samples/second.
  [36864, 128000, 'L', 30, 552960], [122880, 1500000, 'L', 60, 3686400], [245760, 3000000, 'L', 63, 7372800],
  [552960, 6000000, 'L', 90, 16588800], [983040, 10000000, 'L', 93, 33177600], [2228224, 12000000, 'L', 120, 66846720],
  [2228224, 30000000, 'H', 120, 66846720], [2228224, 20000000, 'L', 123, 133693440], [2228224, 50000000, 'H', 123, 133693440],
  [8912896, 25000000, 'L', 150, 267386880], [8912896, 100000000, 'H', 150, 267386880], [8912896, 40000000, 'L', 153, 534773760],
  [8912896, 160000000, 'H', 153, 534773760], [8912896, 60000000, 'L', 156, 1069547520], [8912896, 240000000, 'H', 156, 1069547520],
  [35651584, 60000000, 'L', 180, 1069547520], [35651584, 240000000, 'H', 180, 1069547520], [35651584, 120000000, 'L', 183, 2139095040],
  [35651584, 480000000, 'H', 183, 2139095040], [35651584, 240000000, 'L', 186, 4278190080], [35651584, 800000000, 'H', 186, 4278190080],
] as const

export interface VideoEditExportEncoderSpec {
  width: number; height: number; frameRate: number; bitrate: number; codec?: 'avc' | 'hevc'
  bitrateMode?: 'vbr' | 'cbr'; encoderPreference?: 'hardware' | 'software'
  keyframeInterval?: VideoEditExportSettings['keyframeInterval']
}
export interface VideoEditExportAudioEncoderSpec {
  codec: 'aac' | 'pcm-s24'; sampleRate: number; numberOfChannels: number; bitrate?: number
}
export function videoEditExportVideoEncoderConfig(spec: VideoEditExportEncoderSpec & { codec: 'avc' | 'hevc' }): VideoEncoderConfig {
  const size = spec.codec === 'avc' ? Math.ceil(spec.width / 16) * Math.ceil(spec.height / 16) : spec.width * spec.height
  const avc = avcLevels.find(([maximum, bitrate, , throughput]) => size <= maximum && spec.bitrate <= bitrate && size * spec.frameRate <= throughput) ?? avcLevels[avcLevels.length - 1]
  const hevc = hevcLevels.find(([maximum, bitrate, , , throughput]) => size <= maximum && spec.bitrate <= bitrate && size * spec.frameRate <= throughput) ?? hevcLevels[hevcLevels.length - 1]
  // CanvasSource's VideoSample has square pixels. These display dimensions are absent in canEncodeVideo's default probe.
  return { codec: spec.codec === 'avc' ? `avc1.6400${avc[2].toString(16).padStart(2, '0')}` : `hev1.1.6.${hevc[2]}${hevc[3]}.B0`,
    width: spec.width, height: spec.height, displayWidth: spec.width, displayHeight: spec.height,
    bitrate: spec.bitrate, bitrateMode: spec.bitrateMode === 'cbr' ? 'constant' : 'variable', alpha: 'discard',
    framerate: spec.frameRate, latencyMode: 'quality', hardwareAcceleration: spec.encoderPreference === 'software' ? 'prefer-software' : 'prefer-hardware',
    scalabilityMode: undefined, contentHint: undefined,
    ...(spec.codec === 'avc' ? { avc: { format: 'avc' as const } } : { hevc: { format: 'hevc' as const } }) }
}
export function videoEditExportAudioEncoderConfig(spec: VideoEditExportAudioEncoderSpec): AudioEncoderConfig & { aac?: { format: 'aac' } } {
  if (spec.codec === 'pcm-s24') return { codec: 'pcm-s24', numberOfChannels: spec.numberOfChannels, sampleRate: spec.sampleRate, bitrate: undefined, bitrateMode: undefined }
  return { codec: 'mp4a.40.2', numberOfChannels: spec.numberOfChannels, sampleRate: spec.sampleRate,
    bitrate: spec.bitrate, bitrateMode: undefined, aac: { format: 'aac' } }
}
export function videoEditExportVideoOptions(settings: Pick<VideoEditExportSettings, 'codec' | 'width' | 'height' | 'fps' | 'videoBitrateMbps' | 'bitrateMode' | 'encoderPreference' | 'keyframeInterval'>): VideoEncodingConfig {
  if (settings.fps === null) throw new Error('请先解析序列帧率。')
  const config = videoEditExportVideoEncoderConfig({ ...settings, frameRate: settings.fps, bitrate: Math.round(settings.videoBitrateMbps * 1_000_000) })
  return { codec: settings.codec, bitrate: config.bitrate, bitrateMode: config.bitrateMode as 'constant' | 'variable',
    fullCodecString: config.codec, hardwareAcceleration: config.hardwareAcceleration, latencyMode: config.latencyMode, alpha: config.alpha,
    ...(settings.keyframeInterval === 'auto' ? {} : { keyFrameInterval: settings.keyframeInterval }) }
}
export function videoEditExportAudioOptions(settings: Pick<VideoEditExportSettings, 'audioCodec' | 'audioBitrateKbps' | 'sampleRate' | 'channels'>): AudioEncodingConfig {
  const codec = settings.audioCodec === 'wav' ? 'pcm-s24' : 'aac'
  const config = videoEditExportAudioEncoderConfig({ codec, sampleRate: settings.sampleRate, numberOfChannels: settings.channels, bitrate: settings.audioBitrateKbps * 1000 })
  return { codec,
    ...(settings.audioCodec === 'wav' ? {} : { bitrate: config.bitrate, fullCodecString: config.codec }),
    transform: { sampleRate: settings.sampleRate, numberOfChannels: settings.channels } }
}
