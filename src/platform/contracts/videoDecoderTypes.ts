/**
 * 原生视频解码服务的素材探测与状态契约（主进程、preload、渲染层共用，无 DOM 依赖）。
 * 字段与 electron/main/services/video-decoder/protocol.ts 的 `VideoDecoderProbeResult` 同名，只保留剪辑需要的子集，
 * 并由主进程按握手的解码器清单补上每条流是否可解码。
 */

export interface NativeMediaRational {
  num: number
  den: number
}

export interface NativeMediaStream {
  index: number
  kind: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment' | 'unknown'
  codec: string | null
  profile: string | null
  /** 流起点（秒，容器时间轴，可能非零）。 */
  startTimeSeconds: number | null
  durationSeconds: number | null
  isAttachedPicture: boolean
  /** 原生服务带有该编码的解码器。 */
  decodable: boolean
  video?: {
    width: number
    height: number
    bitDepth: number | null
    chromaSubsampling: string | null
    hasAlpha: boolean
    avgFrameRate: NativeMediaRational | null
    realFrameRate: NativeMediaRational | null
    rotationDegrees: number | null
  }
  audio?: { sampleRate: number; channels: number }
}

export interface NativeMediaProbe {
  /** `durationSeconds` 是终点减起点；绝对结束时间为 `startTimeSeconds + durationSeconds`。 */
  container: { formatName: string | null; startTimeSeconds: number | null; durationSeconds: number | null }
  primaryVideoStreamIndex: number | null
  primaryAudioStreamIndex: number | null
  streams: NativeMediaStream[]
}

/**
 * `unavailable`：原生服务在本机不可用（未安装、启动失败、进程退出、超时、其他平台）；
 * `unreadable`：服务正常但读不了这个文件（打不开、识别不到流信息）。
 */
export type NativeMediaProbeOutcome =
  | { status: 'probed'; probe: NativeMediaProbe }
  | { status: 'unavailable' }
  | { status: 'unreadable'; message: string }

export type NativeDecodeBackend = 'native' | 'browser'

export interface NativeVideoDecoderStatus {
  /** 原生服务已握手可用。 */
  available: boolean
  /** 开发诊断变量 `HENJI_VIDEO_DECODER` 强制的解码后端；未设置为 null。只用于测试，不显示在界面。 */
  forcedBackend: NativeDecodeBackend | null
}

export interface NativeMediaProbeRequest {
  /** 渲染层生成的请求标识，用于取消。 */
  requestId: string
  path: string
}
