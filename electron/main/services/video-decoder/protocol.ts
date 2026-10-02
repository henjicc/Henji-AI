/**
 * 原生视频解码服务（native/video-decoder）控制通道协议：4 字节小端长度前缀 + UTF-8 JSON。
 * 与 native/video-decoder/src/protocol.rs 保持一致；画面走显卡共享纹理，不走本通道。
 * 服务主动发出的事件没有 `id`，以 `event` 区分（`frame`、`stream_ended`）。
 */

/** 2：帧流命令（1.2）、`frame`/`stream_ended` 事件，hello 携带 clientPid。 */
export const VIDEO_DECODER_PROTOCOL_VERSION = 2
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
  | 'GPU_FAILED'
  | 'GPU_UNAVAILABLE'
  | 'CLIENT_UNAVAILABLE'
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

/** `sharedTexture.importSharedTexture` 支持的像素格式。 */
export type VideoSharedFormat = 'nv12' | 'nv16' | 'p010le' | 'rgba' | 'bgra' | 'rgbaf16'

export type VideoDecoderD3D11Summary =
  | {
      available: true
      adapter: VideoDecoderAdapter
      featureLevel: string
      videoDecoderProfiles: { available: boolean; count: number; named: string[] }
      sharedFormats?: Partial<Record<VideoSharedFormat, { texture2d: boolean; shaderLoad: boolean; shaderSample: boolean; renderTarget: boolean }>>
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
  /** 客户端进程登记结果：ready=false 时帧流不可用（无法复制纹理句柄）。 */
  client?: { pid: number | null; ready: boolean; reason?: string }
}

/** Electron `ColorSpace` 结构（原生服务按格式给出）。 */
export interface VideoFrameColorSpace {
  primaries: string
  transfer: string
  matrix: string
  range: string
}

export interface VideoDecoderTestStreamRequest {
  streamId: string
  format: VideoSharedFormat
  width: number
  height: number
  fps: number
  poolSize?: number
  maxFrames?: number
  keyedMutex?: boolean
}

/** 帧流启动结果：每个槽位一个已复制到本进程的 NT 句柄（十进制字符串）。 */
export interface VideoDecoderStreamStarted {
  streamId: string
  format: VideoSharedFormat
  codedSize: { width: number; height: number }
  visibleRect: { x: number; y: number; width: number; height: number }
  colorSpace: VideoFrameColorSpace
  fps: number
  keyedMutex: boolean
  slots: Array<{ slot: number; handle: string }>
  /** 测试画面布局（渲染进程像素校验用），真实解码流没有。 */
  pattern?: unknown
  setupMs: number
}

export interface VideoDecoderStreamCounters {
  produced: number
  skipped: number
  released: number
  duplicateReleases: number
  outstanding: number
  renderUsAverage: number
}

export interface VideoDecoderStreamStopped {
  streamId: string
  stopped: boolean
  final: { streamId: string; format: VideoSharedFormat; width: number; height: number; counters: VideoDecoderStreamCounters } | null
}

export interface VideoDecoderStats {
  pid: number
  cpuMs: number
  handleCount: number
  gpuLocalMemory: { currentUsageBytes: number; budgetBytes: number } | null
  streams: Array<{ streamId: string; format: VideoSharedFormat; width: number; height: number; running: boolean; counters: VideoDecoderStreamCounters }>
}

export interface VideoDecoderFrameEvent {
  event: 'frame'
  streamId: string
  slot: number
  frameIndex: number
  timestampUs: number
}

export interface VideoDecoderStreamEndedEvent {
  event: 'stream_ended'
  streamId: string
  reason: 'completed' | 'error'
  message: string | null
  counters: VideoDecoderStreamCounters
}

export type VideoDecoderEvent = VideoDecoderFrameEvent | VideoDecoderStreamEndedEvent

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
  | { type: 'hello'; clientPid?: number }
  | { type: 'probe'; path: string }
  | { type: 'cancel'; targetId: string }
  | { type: 'shutdown' }
  | ({ type: 'start_test_stream' } & VideoDecoderTestStreamRequest)
  | { type: 'stop_stream'; streamId: string }
  | { type: 'stats' }
  | { type: 'close_client_handles'; handles: string[] }

/** 通知类命令：不等待响应。 */
export type VideoDecoderNotification = { type: 'release_frame'; streamId: string; slot: number }

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

export function isVideoDecoderEvent(value: unknown): value is VideoDecoderEvent {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.streamId !== 'string') return false
  if (record.event === 'frame') return typeof record.slot === 'number' && typeof record.frameIndex === 'number' && typeof record.timestampUs === 'number'
  return record.event === 'stream_ended'
}

const NATIVE_ERROR_CODES = new Set<VideoDecoderErrorCode>(['INVALID_REQUEST', 'OPEN_FAILED', 'STREAM_INFO_FAILED', 'GPU_FAILED', 'GPU_UNAVAILABLE', 'CLIENT_UNAVAILABLE', 'INTERNAL', 'CANCELLED'])

export function nativeErrorCode(code: string | undefined): VideoDecoderErrorCode {
  return code && NATIVE_ERROR_CODES.has(code as VideoDecoderErrorCode) ? (code as VideoDecoderErrorCode) : 'INTERNAL'
}
