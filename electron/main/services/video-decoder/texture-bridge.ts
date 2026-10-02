import type { ImportSharedTextureOptions, SendSharedTextureOptions, SharedTextureImported, WebFrameMain } from 'electron'
import type { MainLogger } from '../logging/main-logger'
import type { VideoDecoderLifecycleEvent, VideoDecoderService, VideoDecoderServiceState } from './client'
import type {
  VideoFrameBridgeStats,
  VideoFrameBridgeStreamStats,
  VideoFrameDurationSummary,
  VideoFrameMeta,
  VideoFrameNativeStats,
  VideoFrameStreamEndedPayload,
  VideoFrameStreamInfo,
  VideoFrameStreamState,
  VideoFrameTestStreamRequest,
  VideoSharedFormat,
} from '../../../../src/platform/contracts/videoFrameTypes'
import {
  VideoDecoderError,
  type VideoDecoderEvent,
  type VideoDecoderFrameEvent,
  type VideoDecoderStreamStarted,
} from './protocol'

export type {
  VideoFrameBridgeStats,
  VideoFrameBridgeStreamStats,
  VideoFrameMeta,
  VideoFrameStreamEndedPayload,
  VideoFrameStreamInfo,
  VideoFrameTestStreamRequest,
} from '../../../../src/platform/contracts/videoFrameTypes'

/**
 * 显卡纹理零拷贝桥（主进程唯一的 `sharedTexture` 使用点）：
 *
 * 原生服务帧就绪（`frame` 事件，槽位 + 时间戳）→ 按槽位的 NT 句柄 `importSharedTexture` →
 * `sendSharedTexture` 到发起请求的窗口主 frame（preload 接收）→ 主进程立即释放自己的引用；
 * Electron 在所有进程引用释放后回调 `allReferencesReleased`，桥再通知原生服务该槽位可复用。
 *
 * 句柄所有权：槽位句柄由原生服务复制进本进程并负责关闭（`stop_stream` 时远程关闭）；
 * Electron 每次导入自行复制一份。因此流一旦进入关闭流程就不再导入它的任何帧。
 * 原生进程异常退出时它来不及关闭这些句柄，桥记下后交给下一个服务进程关闭。
 */

/** 帧的目标窗口：生产用 WebContents 适配，测试注入假对象。 */
export interface VideoFrameTarget {
  readonly id: number
  isDestroyed(): boolean
  readonly mainFrame: WebFrameMain
  send(channel: string, payload: unknown): void
  /** 页面导航、渲染进程退出或销毁时回调（页面里的接收端与帧随之失效）。返回取消订阅。 */
  onGone(listener: (reason: string) => void): () => void
}

export interface SharedTextureApi {
  importSharedTexture(options: ImportSharedTextureOptions): SharedTextureImported
  sendSharedTexture(options: SendSharedTextureOptions, ...args: unknown[]): Promise<void>
}

export type VideoFrameBridgeService = Pick<VideoDecoderService, 'startTestStream' | 'stopStream' | 'notify' | 'onEvent' | 'onLifecycle' | 'closeClientHandles' | 'stats'> & {
  readonly state: VideoDecoderServiceState
}

export interface VideoFrameBridgeOptions {
  service: VideoFrameBridgeService
  sharedTexture: SharedTextureApi
  logger: Pick<MainLogger, 'debug' | 'info' | 'warn' | 'error'>
  now?: () => number
  /** 帧导入后超过该时长仍未释放视为逾期（记日志，不能强制回收）。 */
  releaseOverdueMs?: number
  /** 逾期检查间隔；0 关闭（测试手动调用 checkOverdue）。 */
  overdueCheckIntervalMs?: number
  maxStreamsPerTarget?: number
  /** 放行实测不可用的格式（仅诊断复测）。 */
  allowUnsupportedFormats?: boolean
}

export const VIDEO_FRAMES_STREAM_ENDED_CHANNEL = 'videoFrames:streamEnded'

const SHARED_FORMATS: readonly VideoSharedFormat[] = ['nv12', 'nv16', 'p010le', 'rgba', 'bgra', 'rgbaf16']
/**
 * 1.2 实测（Electron 42.5 / Windows / RTX 4090，重要记录 007）在本通道不可用的格式：
 * - p010le：渲染进程 VideoFrame.format 为 null，GPU 进程卡顿约 0.8s 后渲染进程崩溃（STATUS_BREAKPOINT）；
 * - nv16：对应的 DXGI_FORMAT_P208 在驱动上不能创建为 2D 纹理。
 * 原生侧改用 rgbaf16 输出这些位深/采样；诊断时可用 HENJI_VIDEO_FRAMES_UNSUPPORTED_FORMATS=1 放行复测。
 */
export const VIDEO_FRAMES_UNSUPPORTED_FORMATS: ReadonlySet<VideoSharedFormat> = new Set(['p010le', 'nv16'])
const ROUTE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const SAMPLE_LIMIT = 8192

class DurationSampler {
  private readonly values: number[] = []
  private next = 0

  add(value: number): void {
    if (this.values.length < SAMPLE_LIMIT) this.values.push(value)
    else {
      this.values[this.next] = value
      this.next = (this.next + 1) % SAMPLE_LIMIT
    }
  }

  summary(): VideoFrameDurationSummary {
    const sorted = [...this.values].sort((a, b) => a - b)
    const at = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0)
    const round = (value: number) => Math.round(value * 1000) / 1000
    return {
      count: sorted.length,
      mean: round(sorted.length ? sorted.reduce((total, value) => total + value, 0) / sorted.length : 0),
      p50: round(at(0.5)),
      p95: round(at(0.95)),
      p99: round(at(0.99)),
      max: round(sorted.at(-1) ?? 0),
    }
  }
}

interface OutstandingFrame {
  frameIndex: number
  importedAt: number
  overdueLogged: boolean
}

interface BridgeStream {
  id: string
  route: string
  target: VideoFrameTarget
  info: VideoDecoderStreamStarted
  handles: Buffer[]
  state: VideoFrameStreamState
  outstanding: Map<number, OutstandingFrame>
  delivered: number
  importFailures: number
  sendFailures: number
  released: number
  overdueReleases: number
  handoff: DurationSampler
  sync: DurationSampler
  release: DurationSampler
  firstFrameLogged: boolean
  stopGone: () => void
}

/** 把原生服务给出的句柄值（十进制字符串）编码为 Electron 期望的 8 字节小端 ntHandle。 */
export function encodeNtHandle(handle: string): Buffer {
  if (!/^\d{1,20}$/.test(handle)) throw new VideoDecoderError('PROTOCOL_ERROR', `纹理句柄格式无效：${handle}`)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64LE(BigInt(handle))
  return buffer
}

export function parseVideoFrameTestStreamRequest(input: unknown): VideoFrameTestStreamRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('帧流请求必须是对象')
  const record = input as Record<string, unknown>
  const integer = (field: string, min: number, max: number, optional = false): number | undefined => {
    const value = record[field]
    if (value === undefined && optional) return undefined
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`帧流参数 ${field} 无效`)
    return value
  }
  if (typeof record.route !== 'string' || !ROUTE_PATTERN.test(record.route)) throw new Error('帧流参数 route 无效')
  if (typeof record.format !== 'string' || !SHARED_FORMATS.includes(record.format as VideoSharedFormat)) throw new Error('帧流参数 format 无效')
  if (typeof record.fps !== 'number' || !(record.fps > 0 && record.fps <= 240)) throw new Error('帧流参数 fps 无效')
  if (record.keyedMutex !== undefined && typeof record.keyedMutex !== 'boolean') throw new Error('帧流参数 keyedMutex 无效')
  return {
    route: record.route,
    format: record.format as VideoSharedFormat,
    width: integer('width', 2, 8192) as number,
    height: integer('height', 2, 8192) as number,
    fps: record.fps,
    poolSize: integer('poolSize', 2, 16, true),
    maxFrames: integer('maxFrames', 1, Number.MAX_SAFE_INTEGER, true),
    keyedMutex: record.keyedMutex as boolean | undefined,
  }
}

export class VideoFrameBridge {
  private readonly streams = new Map<string, BridgeStream>()
  /** 启动响应尚未处理时先到达的帧（同一块 stdout 里响应之后紧跟首帧）。 */
  private readonly pendingStarts = new Map<string, VideoDecoderFrameEvent[]>()
  private readonly orphanHandles = new Set<string>()
  private unreleasedImports = 0
  private nextStreamId = 1
  private overdueTimer: ReturnType<typeof setInterval> | null = null
  private readonly now: () => number
  private readonly releaseOverdueMs: number
  private readonly maxStreamsPerTarget: number
  private readonly unsubscribe: Array<() => void>

  constructor(private readonly options: VideoFrameBridgeOptions) {
    this.now = options.now ?? (() => performance.now())
    this.releaseOverdueMs = options.releaseOverdueMs ?? 3_000
    this.maxStreamsPerTarget = options.maxStreamsPerTarget ?? 16
    this.unsubscribe = [
      options.service.onEvent((event) => this.handleEvent(event)),
      options.service.onLifecycle((event) => this.handleLifecycle(event)),
    ]
  }

  async openTestStream(target: VideoFrameTarget, request: VideoFrameTestStreamRequest): Promise<VideoFrameStreamInfo> {
    if (target.isDestroyed()) throw new Error('目标窗口已关闭')
    if (VIDEO_FRAMES_UNSUPPORTED_FORMATS.has(request.format) && !this.options.allowUnsupportedFormats) {
      throw new Error(`显卡帧通道不支持 ${request.format} 格式`)
    }
    const owned = [...this.streams.values()].filter((stream) => stream.target.id === target.id).length
    if (owned >= this.maxStreamsPerTarget) throw new Error(`同一窗口最多 ${this.maxStreamsPerTarget} 路帧流`)
    const streamId = `vf-${this.nextStreamId++}`
    const startedAt = this.now()
    this.options.logger.info('打开测试帧流', { event: 'video_frames.stream.open.start', context: { streamId, targetId: target.id, ...request } })
    this.pendingStarts.set(streamId, [])
    let info: VideoDecoderStreamStarted
    try {
      info = await this.options.service.startTestStream({
        streamId,
        format: request.format,
        width: request.width,
        height: request.height,
        fps: request.fps,
        poolSize: request.poolSize,
        maxFrames: request.maxFrames,
        keyedMutex: request.keyedMutex,
      })
    } catch (error) {
      this.pendingStarts.delete(streamId)
      this.options.logger.warn('打开测试帧流失败', { event: 'video_frames.stream.open.failed', error, context: { streamId, code: error instanceof VideoDecoderError ? error.code : undefined } })
      throw error
    }
    const queued = this.pendingStarts.get(streamId) ?? []
    this.pendingStarts.delete(streamId)
    let handles: Buffer[]
    try {
      handles = info.slots.map((slot) => encodeNtHandle(slot.handle))
    } catch (error) {
      void this.options.service.stopStream(streamId).catch(() => undefined)
      throw error
    }
    if (target.isDestroyed()) {
      void this.options.service.stopStream(streamId).catch(() => undefined)
      throw new Error('目标窗口已关闭')
    }
    const stream: BridgeStream = {
      id: streamId,
      route: request.route,
      target,
      info,
      handles,
      state: 'open',
      outstanding: new Map(),
      delivered: 0,
      importFailures: 0,
      sendFailures: 0,
      released: 0,
      overdueReleases: 0,
      handoff: new DurationSampler(),
      sync: new DurationSampler(),
      release: new DurationSampler(),
      firstFrameLogged: false,
      stopGone: () => undefined,
    }
    stream.stopGone = target.onGone((reason) => this.closeTarget(target.id, reason))
    this.streams.set(streamId, stream)
    this.ensureOverdueTimer()
    this.options.logger.info('测试帧流已打开', {
      event: 'video_frames.stream.open.completed',
      context: { streamId, format: info.format, codedSize: info.codedSize, slots: info.slots.length, keyedMutex: info.keyedMutex, elapsedMs: this.now() - startedAt, nativeSetupMs: info.setupMs },
    })
    for (const event of queued) this.handleFrame(event)
    return {
      streamId,
      route: request.route,
      format: info.format,
      codedSize: info.codedSize,
      colorSpace: info.colorSpace,
      fps: info.fps,
      poolSize: info.slots.length,
      pattern: info.pattern,
    }
  }

  /** 关闭流：先停止导入（从表中移除），再让原生服务停止并关闭句柄。在途帧的引用照常释放。 */
  async closeStream(streamId: string, reason = 'requested', targetId?: number): Promise<boolean> {
    const stream = this.streams.get(streamId)
    if (!stream || (targetId !== undefined && stream.target.id !== targetId)) return false
    this.streams.delete(streamId)
    stream.state = 'closing'
    stream.stopGone()
    const summary = this.streamStats(stream)
    try {
      const stopped = await this.options.service.stopStream(streamId)
      this.options.logger.info('帧流已关闭', { event: 'video_frames.stream.closed', context: { reason, ...summary, native: stopped.final?.counters ?? null } })
    } catch (error) {
      // 服务已退出时句柄由生命周期处理收集，这里只记录。
      this.options.logger.warn('关闭帧流时原生服务未响应', { event: 'video_frames.stream.close_failed', error, context: { streamId, reason } })
    }
    this.stopOverdueTimerIfIdle()
    return true
  }

  async closeTarget(targetId: number, reason: string): Promise<void> {
    const owned = [...this.streams.values()].filter((stream) => stream.target.id === targetId)
    await Promise.all(owned.map((stream) => this.closeStream(stream.id, reason)))
  }

  async stats(): Promise<VideoFrameBridgeStats> {
    let native: VideoFrameNativeStats | null = null
    if (this.options.service.state === 'ready') {
      native = await this.options.service.stats().catch(() => null)
    }
    const cpu = process.cpuUsage()
    return {
      streams: [...this.streams.values()].map((stream) => this.streamStats(stream)),
      unreleasedImports: this.unreleasedImports,
      orphanHandles: this.orphanHandles.size,
      mainCpuMicros: { user: cpu.user, system: cpu.system },
      native,
    }
  }

  /** 检查逾期未释放的帧（定时器调用，测试可直接调用）。 */
  checkOverdue(): void {
    const now = this.now()
    for (const stream of this.streams.values()) {
      for (const [slot, frame] of stream.outstanding) {
        if (frame.overdueLogged || now - frame.importedAt < this.releaseOverdueMs) continue
        frame.overdueLogged = true
        stream.overdueReleases += 1
        this.options.logger.warn('帧引用逾期未释放', { event: 'video_frames.release.overdue', context: { streamId: stream.id, slot, frameIndex: frame.frameIndex, heldMs: Math.round(now - frame.importedAt) } })
      }
    }
  }

  async dispose(): Promise<void> {
    for (const stop of this.unsubscribe) stop()
    await Promise.all([...this.streams.keys()].map((streamId) => this.closeStream(streamId, 'disposed')))
    if (this.overdueTimer) clearInterval(this.overdueTimer)
    this.overdueTimer = null
  }

  private streamStats(stream: BridgeStream): VideoFrameBridgeStreamStats {
    return {
      streamId: stream.id,
      route: stream.route,
      targetId: stream.target.id,
      format: stream.info.format,
      width: stream.info.codedSize.width,
      height: stream.info.codedSize.height,
      fps: stream.info.fps,
      state: stream.state,
      delivered: stream.delivered,
      importFailures: stream.importFailures,
      sendFailures: stream.sendFailures,
      released: stream.released,
      outstanding: stream.outstanding.size,
      overdueReleases: stream.overdueReleases,
      handoffMs: stream.handoff.summary(),
      syncMs: stream.sync.summary(),
      releaseMs: stream.release.summary(),
    }
  }

  private handleEvent(event: VideoDecoderEvent): void {
    if (event.event === 'frame') {
      const pending = this.pendingStarts.get(event.streamId)
      if (pending) pending.push(event)
      else this.handleFrame(event)
      return
    }
    const stream = this.streams.get(event.streamId)
    if (!stream) return
    stream.state = 'ended'
    this.options.logger[event.reason === 'error' ? 'warn' : 'info']('原生帧流已结束', { event: 'video_frames.stream.ended', context: { streamId: stream.id, reason: event.reason, message: event.message, counters: event.counters } })
    this.notifyEnded(stream, event.reason, event.message)
    // 原生侧已不再出帧；回收池与句柄（在途帧引用不受影响）。
    void this.closeStream(stream.id, `native_${event.reason}`)
  }

  private handleFrame(event: VideoDecoderFrameEvent): void {
    const stream = this.streams.get(event.streamId)
    if (!stream || stream.state !== 'open') {
      // 未登记或正在关闭的流：不导入（句柄可能已关闭），归还槽位。原生侧对已停止的流忽略该通知。
      this.options.service.notify({ type: 'release_frame', streamId: event.streamId, slot: event.slot })
      return
    }
    if (stream.target.isDestroyed()) {
      this.options.service.notify({ type: 'release_frame', streamId: event.streamId, slot: event.slot })
      void this.closeTarget(stream.target.id, 'destroyed')
      return
    }
    const handle = stream.handles[event.slot]
    if (!handle) {
      this.options.logger.error('原生帧流给出未知槽位', { event: 'video_frames.frame.unknown_slot', context: { streamId: stream.id, slot: event.slot } })
      return
    }
    const importedAt = this.now()
    const info = stream.info
    let imported: SharedTextureImported
    try {
      imported = this.options.sharedTexture.importSharedTexture({
        textureInfo: {
          pixelFormat: info.format,
          codedSize: info.codedSize,
          visibleRect: info.visibleRect,
          timestamp: event.timestampUs,
          colorSpace: info.colorSpace as ImportSharedTextureOptions['textureInfo']['colorSpace'],
          handle: { ntHandle: handle },
        },
        allReferencesReleased: () => this.handleReleased(stream, event.slot, importedAt),
      })
    } catch (error) {
      stream.importFailures += 1
      if (stream.importFailures === 1 || stream.importFailures % 100 === 0) {
        this.options.logger.warn('导入共享纹理失败', { event: 'video_frames.frame.import_failed', error, context: { streamId: stream.id, slot: event.slot, failures: stream.importFailures } })
      }
      this.options.service.notify({ type: 'release_frame', streamId: stream.id, slot: event.slot })
      return
    }
    this.unreleasedImports += 1
    stream.outstanding.set(event.slot, { frameIndex: event.frameIndex, importedAt, overdueLogged: false })
    const meta: VideoFrameMeta = { route: stream.route, streamId: stream.id, frameIndex: event.frameIndex, timestampUs: event.timestampUs }
    let sending: Promise<void>
    try {
      sending = this.options.sharedTexture.sendSharedTexture({ frame: stream.target.mainFrame, importedSharedTexture: imported }, meta)
    } catch (error) {
      sending = Promise.reject(error)
    }
    stream.sync.add(this.now() - importedAt)
    sending.then(
      () => {
        stream.delivered += 1
        const handoffMs = this.now() - importedAt
        stream.handoff.add(handoffMs)
        if (!stream.firstFrameLogged) {
          stream.firstFrameLogged = true
          this.options.logger.info('首帧已送达渲染进程', { event: 'video_frames.stream.first_frame', context: { streamId: stream.id, frameIndex: event.frameIndex, handoffMs } })
        }
      },
      (error: unknown) => {
        stream.sendFailures += 1
        if (stream.sendFailures === 1 || stream.sendFailures % 100 === 0) {
          this.options.logger.warn('发送共享纹理到渲染进程失败', { event: 'video_frames.frame.send_failed', error, context: { streamId: stream.id, slot: event.slot, failures: stream.sendFailures } })
        }
      },
    ).finally(() => imported.release())
  }

  private handleReleased(stream: BridgeStream, slot: number, importedAt: number): void {
    this.unreleasedImports = Math.max(0, this.unreleasedImports - 1)
    stream.outstanding.delete(slot)
    stream.released += 1
    stream.release.add(this.now() - importedAt)
    // 只有仍由原生服务持有池的流才归还槽位；关闭中的流其池已随 stop_stream 回收。
    if (stream.state !== 'closing') {
      this.options.service.notify({ type: 'release_frame', streamId: stream.id, slot })
    }
  }

  private handleLifecycle(event: VideoDecoderLifecycleEvent): void {
    if (event.type === 'exited') {
      for (const stream of [...this.streams.values()]) {
        this.streams.delete(stream.id)
        stream.state = 'closing'
        stream.stopGone()
        for (const slot of stream.info.slots) this.orphanHandles.add(slot.handle)
        this.notifyEnded(stream, 'service_exited', '原生视频解码服务异常退出')
      }
      if (this.orphanHandles.size > 0) {
        this.options.logger.warn('原生服务退出，帧流失效', { event: 'video_frames.service.exited', context: { pid: event.pid, orphanHandles: this.orphanHandles.size } })
      }
      this.stopOverdueTimerIfIdle()
      return
    }
    if (this.orphanHandles.size === 0) return
    const handles = [...this.orphanHandles]
    this.orphanHandles.clear()
    void this.options.service.closeClientHandles(handles).then(
      (result) => this.options.logger.info('已回收遗留纹理句柄', { event: 'video_frames.orphans.closed', context: { closed: result.closed, failed: result.failed.length } }),
      (error: unknown) => {
        for (const handle of handles) this.orphanHandles.add(handle)
        this.options.logger.warn('回收遗留纹理句柄失败', { event: 'video_frames.orphans.close_failed', error, context: { count: handles.length } })
      },
    )
  }

  private notifyEnded(stream: BridgeStream, reason: VideoFrameStreamEndedPayload['reason'], message: string | null): void {
    if (stream.target.isDestroyed()) return
    const payload: VideoFrameStreamEndedPayload = { streamId: stream.id, route: stream.route, reason, message }
    stream.target.send(VIDEO_FRAMES_STREAM_ENDED_CHANNEL, payload)
  }

  private ensureOverdueTimer(): void {
    const interval = this.options.overdueCheckIntervalMs ?? 1_000
    if (this.overdueTimer || interval <= 0) return
    this.overdueTimer = setInterval(() => this.checkOverdue(), interval)
    this.overdueTimer.unref?.()
  }

  private stopOverdueTimerIfIdle(): void {
    if (this.streams.size > 0 || !this.overdueTimer) return
    clearInterval(this.overdueTimer)
    this.overdueTimer = null
  }
}
