/**
 * 原生视频解码服务（native/video-decoder）控制通道协议：4 字节小端长度前缀 + UTF-8 JSON。
 * 与 native/video-decoder/src/protocol.rs 保持一致；画面不走本通道。
 */

export const VIDEO_DECODER_PROTOCOL_VERSION = 1
export const VIDEO_DECODER_MAX_MESSAGE_BYTES = 16 * 1024 * 1024

export type VideoDecoderErrorCode =
  | 'UNAVAILABLE'
  | 'START_FAILED'
  | 'HANDSHAKE_FAILED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'PROCESS_EXITED'
  | 'PROTOCOL_ERROR'
  | 'STOPPED'
  // 以下由原生服务返回
  | 'INVALID_REQUEST'
  | 'OPEN_FAILED'
  | 'STREAM_INFO_FAILED'
  | 'INTERNAL'

export class VideoDecoderError extends Error {
  readonly code: VideoDecoderErrorCode

  constructor(code: VideoDecoderErrorCode, message: string) {
    super(message)
    this.name = 'VideoDecoderError'
    this.code = code
  }
}

export interface VideoDecoderRational {
  num: number
  den: number
}

export interface VideoDecoderAdapter {
  description: string
  vendorId: string
  deviceId: string
  dedicatedVideoMemoryMiB: number
  sharedSystemMemoryMiB: number
  luid: string
  software: boolean
}

export type VideoDecoderD3D11Summary =
  | {
      available: true
      adapter: VideoDecoderAdapter
      featureLevel: string
      videoDecoderProfiles: { available: boolean; count: number; named: string[] }
      adapters: VideoDecoderAdapter[]
    }
  | { available: false; reason: string }

export interface VideoDecoderHello {
  service: 'henji-video-decoder'
  serviceVersion: string
  protocolVersion: number
  pid: number
  ffmpeg: {
    version: string | null
    libavcodec: string
    libavformat: string
    libavutil: string
    license: string | null
    gplEnabled: boolean
    nonfreeEnabled: boolean
    videoDecoders: string[]
    audioDecoders: string[]
    requiredDecoders: string[]
    missingRequiredDecoders: string[]
    hwDeviceTypes: string[]
  }
  d3d11: VideoDecoderD3D11Summary
  gpuReady: boolean
}

export interface VideoDecoderVideoStreamInfo {
  width: number
  height: number
  pixelFormat: string | null
  bitDepth: number | null
  chromaSubsampling: string | null
  isRgb: boolean
  hasAlpha: boolean
  avgFrameRate: VideoDecoderRational | null
  realFrameRate: VideoDecoderRational | null
  frameRate: number | null
  sampleAspectRatio: VideoDecoderRational | null
  fieldOrder: string
  rotationDegrees: number | null
  color: {
    range: string | null
    primaries: string | null
    transfer: string | null
    matrix: string | null
    chromaLocation: string | null
  }
  hdr: boolean
}

export interface VideoDecoderAudioStreamInfo {
  sampleRate: number
  channels: number
  channelLayout: string | null
  sampleFormat: string | null
  bitsPerSample: number | null
}

export interface VideoDecoderStreamInfo {
  index: number
  kind: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment' | 'unknown'
  codec: string | null
  codecLongName: string | null
  profile: string | null
  codecTag: string | null
  timeBase: VideoDecoderRational | null
  startTimeSeconds: number | null
  durationSeconds: number | null
  frameCount: number | null
  bitRate: number | null
  isDefault: boolean
  isAttachedPicture: boolean
  video?: VideoDecoderVideoStreamInfo
  audio?: VideoDecoderAudioStreamInfo
}

export interface VideoDecoderProbeResult {
  path: string
  container: {
    formatName: string | null
    formatLongName: string | null
    durationSeconds: number | null
    startTimeSeconds: number | null
    bitRate: number | null
  }
  primaryVideoStreamIndex: number | null
  primaryAudioStreamIndex: number | null
  streams: VideoDecoderStreamInfo[]
}

export type VideoDecoderCommand =
  | { type: 'hello' }
  | { type: 'probe'; path: string }
  | { type: 'cancel'; targetId: string }
  | { type: 'shutdown' }

export interface VideoDecoderResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}

export function encodeVideoDecoderFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}

/** 增量拆帧：stdout 分块到达时累积，返回已完整的消息。长度超限抛 PROTOCOL_ERROR。 */
export class VideoDecoderFrameReader {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): unknown[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const messages: unknown[] = []
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (length > VIDEO_DECODER_MAX_MESSAGE_BYTES) {
        throw new VideoDecoderError('PROTOCOL_ERROR', `原生视频解码服务返回了超长消息（${length} 字节）`)
      }
      if (this.buffer.length < 4 + length) break
      const body = this.buffer.subarray(4, 4 + length).toString('utf8')
      this.buffer = this.buffer.subarray(4 + length)
      try {
        messages.push(JSON.parse(body))
      } catch {
        throw new VideoDecoderError('PROTOCOL_ERROR', '原生视频解码服务返回了无法解析的消息')
      }
    }
    return messages
  }
}

export function isVideoDecoderResponse(value: unknown): value is VideoDecoderResponse {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.ok === 'boolean'
}

const NATIVE_ERROR_CODES = new Set<VideoDecoderErrorCode>(['INVALID_REQUEST', 'OPEN_FAILED', 'STREAM_INFO_FAILED', 'INTERNAL', 'CANCELLED'])

export function nativeErrorCode(code: string | undefined): VideoDecoderErrorCode {
  return code && NATIVE_ERROR_CODES.has(code as VideoDecoderErrorCode) ? (code as VideoDecoderErrorCode) : 'INTERNAL'
}
