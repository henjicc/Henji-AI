/**
 * 显卡纹理帧通道的跨层数据契约（主进程纹理桥、preload、渲染层共用）。不依赖 DOM 类型，
 * 主进程与 preload（无 DOM lib）也能直接引用。帧的端口协议与平台接口见 `videoFrames.ts`。
 */

/** `sharedTexture.importSharedTexture` 支持的像素格式。 */
export type VideoSharedFormat = 'nv12' | 'nv16' | 'p010le' | 'rgba' | 'bgra' | 'rgbaf16'

/** 每帧随 VideoFrame 一起到达的元数据。 */
export interface VideoFrameMeta {
  /** `connect()` 返回的通道标识，preload 据此把帧投递到对应端口。 */
  route: string
  streamId: string
  frameIndex: number
  timestampUs: number
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
  colorSpace: VideoFrameColorSpace
  fps: number
  poolSize: number
  /** 合成测试画面的布局（像素校验用）；真实解码流没有。 */
  pattern?: unknown
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
}

export interface VideoFrameNativeStats {
  pid: number
  cpuMs: number
  handleCount: number
  gpuLocalMemory: { currentUsageBytes: number; budgetBytes: number } | null
  streams: Array<{ streamId: string; format: VideoSharedFormat; width: number; height: number; running: boolean; counters: VideoFrameNativeStreamCounters }>
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

