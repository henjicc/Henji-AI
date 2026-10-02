/**
 * 显卡纹理帧通道的跨层数据契约（主进程纹理桥、preload、渲染层共用）。不依赖 DOM 类型，
 * 主进程与 preload（无 DOM lib）也能直接引用。帧的端口协议与平台接口见 `videoFrames.ts`。
 */

/** `sharedTexture.importSharedTexture` 支持的像素格式。 */
export type VideoSharedFormat = 'nv12' | 'nv16' | 'p010le' | 'rgba' | 'bgra' | 'rgbaf16'

/** 解码帧对应的请求：按时间取单帧（`ticket`）或连续计划的第 `index` 项。 */
export type VideoFrameRequestTag = { kind: 'frame_at'; id: string } | { kind: 'schedule'; id: string; index: number }

/** 每帧随 VideoFrame 一起到达的元数据。 */
export interface VideoFrameMeta {
  /** `connect()` 返回的通道标识，preload 据此把帧投递到对应端口。 */
  route: string
  streamId: string
  frameIndex: number
  timestampUs: number
  /** 解码帧：源呈现时间（微秒，与 mediabunny `microsecondTimestamp` 同口径）与时长。 */
  ptsUs?: number
  durationUs?: number
  /** 解码帧对应的请求（测试画面帧没有）。 */
  request?: VideoFrameRequestTag
}

/** preload 把端口交给页面时使用的 window message。 */
export const VIDEO_FRAMES_PORT_MESSAGE_TYPE = 'henji:video-frames-port'

export interface VideoFramesPortWindowMessage {
  type: typeof VIDEO_FRAMES_PORT_MESSAGE_TYPE
  route: string
}

export interface VideoFrameColorSpace {
  primaries: string
  transfer: string
  matrix: string
  range: string
}

export interface VideoFrameTestStreamRequest {
  route: string
  format: VideoSharedFormat
  width: number
  height: number
  fps: number
  poolSize?: number
  maxFrames?: number
  keyedMutex?: boolean
}

export interface VideoFrameStreamInfo {
  streamId: string
  route: string
  format: VideoSharedFormat
  codedSize: { width: number; height: number }
  /** 画面实际区域（nv12 池纹理按偶数对齐，可能大于画面）。 */
  visibleRect?: { x: number; y: number; width: number; height: number }
  colorSpace: VideoFrameColorSpace
  fps: number
  poolSize: number
  /** 合成测试画面的布局（像素校验用）；真实解码流没有。 */
  pattern?: unknown
}

/** 打开原生解码会话（1.3）。`path` 为本地绝对路径，须在已授权的媒体目录内。 */
export interface VideoFrameDecoderRequest {
  route: string
  path: string
  /** 视频流序号；缺省取首选视频流。 */
  streamIndex?: number
  /** playback：连续计划（播放）；seek：按时间取单帧（定位、拖动、导出）。 */
  purpose: 'playback' | 'seek'
  poolSize?: number
  /** off：只用软解（诊断）。 */
  hardware?: 'auto' | 'off'
  /** 强制输出格式（诊断）；nv12 只适用于 8 位 4:2:0 无透明素材。 */
  format?: 'nv12' | 'rgbaf16'
  /** 色彩空间传输特性标注覆盖（诊断，重要记录 007 的标注实验）。 */
  transfer?: string
}

/** 解码会话的解码细节（诊断与日志用，不进正式界面）。 */
export interface VideoFrameDecoderDetails {
  codec: string | null
  decoderName: string
  hardware: boolean
  hardwareRequested: boolean
  pixelFormat: string
  bitDepth: number
  chromaLog2: [number, number]
  hasAlpha: boolean
  path: 'copy_nv12' | 'shader_semiplanar' | 'upload_nv12' | 'shader_planar' | 'cpu_fallback'
  intraOnly: boolean
}

export interface VideoFrameDecoderInfo extends VideoFrameStreamInfo {
  visibleRect: { x: number; y: number; width: number; height: number }
  decoder: VideoFrameDecoderDetails
  timeBase: { num: number; den: number }
  startSeconds: number | null
  endSeconds: number | null
  firstFramePtsUs: number
  rotationDegrees: number | null
  purpose: 'playback' | 'seek'
  /** 文件的色彩解释（未标注项已按 WebCodecs 默认补齐）；rgbaf16 输出的 colorSpace 只给出 rgb/full。 */
  color: { matrix: string; primaries: string; transfer: string; range: 'limited' | 'full'; hdrAsSdr: boolean }
}

export interface VideoFrameAtRequest {
  streamId: string
  /** 源时间（秒）：取呈现时间不晚于它的最后一帧。 */
  time: number
  /** 请求标识，随帧元数据 `request.id` 返回。 */
  ticket: string
}

export interface VideoFrameAtResult {
  ticket: string
  /** 有画面时帧已经（或即将）从端口到达，`request.id === ticket`。 */
  found: boolean
  ptsUs?: number
  timestampSeconds?: number
  durationSeconds?: number
  seeked: boolean
  decodeMs: number
}

/** 连续计划：`times` 每项恰好对应一帧或一个缺帧事件；`range` 交付区间 [from, to) 内每一帧。 */
export interface VideoFrameScheduleRequest {
  streamId: string
  scheduleId: string
  times?: number[]
  range?: { from: number; to?: number }
}

export interface VideoFrameScheduleAck {
  scheduleId: string
  count: number | null
}

/** 计划的非帧事件（经 IPC 到 preload，再投递到流所属通道的端口）。 */
export type VideoFrameScheduleEvent =
  | { type: 'frame_missing'; route: string; streamId: string; scheduleId: string; index: number; reason: 'no_picture' | 'decode_error' | 'superseded' }
  /** `delivered`：本计划发出的帧数（区间计划据此判断最后一帧；帧走另一条通道，可能晚于本事件到达）。 */
  | { type: 'schedule_done'; route: string; streamId: string; scheduleId: string; reason: 'completed' | 'cancelled' | 'error'; message: string | null; delivered?: number }

export const VIDEO_FRAMES_SCHEDULE_EVENT_CHANNEL = 'videoFrames:scheduleEvent'

/**
 * 消费方（渲染 Worker）经帧通道端口直接发起的解码会话请求：preload 转为对应 IPC，打开的会话归属该端口的通道，
 * 不经页面主线程。请求与帧、计划事件共用同一端口；`id` 由消费方分配，响应原样带回。
 */
export type VideoFramePortCall =
  | { method: 'openDecoder'; params: Omit<VideoFrameDecoderRequest, 'route'> }
  | { method: 'frameAt'; params: VideoFrameAtRequest }
  | { method: 'schedule'; params: VideoFrameScheduleRequest }
  | { method: 'cancelSchedule'; params: { streamId: string; scheduleId: string } }
  | { method: 'closeStream'; params: { streamId: string } }

export interface VideoFramePortCallResults {
  openDecoder: VideoFrameDecoderInfo
  frameAt: VideoFrameAtResult
  schedule: VideoFrameScheduleAck
  cancelSchedule: boolean
  closeStream: boolean
}

export interface VideoFramePortRequestMessage {
  type: 'request'
  id: number
  call: VideoFramePortCall
}

export interface VideoFramePortResponseMessage {
  type: 'response'
  id: number
  result?: unknown
  /** 失败原因（主进程或原生服务给出的说明，消费方再转为用户语言）。 */
  error?: string
}


export interface VideoFrameStreamEndedPayload {
  streamId: string
  route: string
  reason: 'completed' | 'error' | 'service_exited'
  message: string | null
}

export interface VideoFrameDurationSummary {
  count: number
  mean: number
  p50: number
  p95: number
  p99: number
  max: number
}

export type VideoFrameStreamState = 'open' | 'ended' | 'closing'

export interface VideoFrameBridgeStreamStats {
  streamId: string
  kind?: 'test' | 'decoder'
  route: string
  targetId: number
  format: VideoSharedFormat
  width: number
  height: number
  fps: number
  state: VideoFrameStreamState
  delivered: number
  importFailures: number
  sendFailures: number
  released: number
  outstanding: number
  overdueReleases: number
  /** 导入到 `sendSharedTexture` 完成（含渲染进程接收回执）。 */
  handoffMs: VideoFrameDurationSummary
  /** 导入与发起发送的同步部分（主进程线程实际占用）。 */
  syncMs: VideoFrameDurationSummary
  /** 导入到全部引用释放。 */
  releaseMs: VideoFrameDurationSummary
}

export interface VideoFrameNativeStreamCounters {
  produced: number
  skipped: number
  released: number
  duplicateReleases: number
  outstanding: number
  renderUsAverage: number
  /** 以下为解码会话计数（测试画面流为 0）。 */
  decoded?: number
  discarded?: number
  missing?: number
  seeks?: number
  /** 播放计划中的剪辑点/跳转（开新段、不 flush）。 */
  cuts?: number
  /** 单帧定位的 flush。 */
  flushes?: number
  /** 排空到文件末尾后再定位的 flush。 */
  eofFlushes?: number
  decodeErrors?: number
  decodeUsTotal?: number
  uploadUsAverage?: number
  waitUsTotal?: number
}

export interface VideoFrameNativeStats {
  pid: number
  cpuMs: number
  handleCount: number
  gpuLocalMemory: { currentUsageBytes: number; budgetBytes: number } | null
  streams: Array<{ streamId: string; kind?: 'test' | 'decoder'; format: VideoSharedFormat | null; width: number; height: number; running: boolean; counters: VideoFrameNativeStreamCounters }>
}

export interface VideoFrameBridgeStats {
  streams: VideoFrameBridgeStreamStats[]
  /** 已导入但尚未收到全部引用释放的帧数（含已关闭流）。 */
  unreleasedImports: number
  /** 等待下一个服务进程关闭的遗留句柄数。 */
  orphanHandles: number
  mainCpuMicros: { user: number; system: number }
  native: VideoFrameNativeStats | null
}

/** preload 侧计数（诊断用）。 */
export interface VideoFramesPreloadStats {
  received: number
  delivered: number
  /** 没有对应端口、直接关闭的帧。 */
  dropped: number
  returned: number
  /** 已投递到端口、尚未交回的帧。 */
  outstanding: number
  routes: string[]
}

