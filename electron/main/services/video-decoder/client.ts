import { spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import type { MainLogger } from '../logging/main-logger'
import {
  encodeVideoDecoderFrame,
  isVideoDecoderEvent,
  isVideoDecoderResponse,
  nativeErrorCode,
  VIDEO_DECODER_PROTOCOL_VERSION,
  VideoDecoderError,
  VideoDecoderFrameReader,
  type VideoDecoderCommand,
  type VideoDecoderEvent,
  type VideoDecoderHello,
  type VideoDecoderNotification,
  type VideoDecoderProbeResult,
  type VideoDecoderStats,
  type VideoDecoderStreamStarted,
  type VideoDecoderStreamStopped,
  type VideoDecoderTestStreamRequest,
} from './protocol'

/** 子进程最小形状：生产用 child_process.spawn，测试注入假进程。 */
export interface VideoDecoderChildProcess {
  readonly pid?: number
  readonly stdin: Writable
  readonly stdout: Readable
  readonly stderr: Readable
  kill(): boolean
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  once(event: 'error', listener: (error: Error) => void): this
}

export type VideoDecoderSpawn = (executable: string) => VideoDecoderChildProcess

export interface VideoDecoderRestartPolicy {
  /** 时间窗内允许的自动重启次数，超过后进入失败状态。 */
  maxRestarts: number
  windowMs: number
  /** 第 n 次重启前等待 backoffMs[n-1]，超出数组取最后一项。 */
  backoffMs: readonly number[]
}

export type VideoDecoderServiceState = 'idle' | 'starting' | 'ready' | 'restarting' | 'failed' | 'unavailable' | 'stopped'

/** 进程生命周期通知：`exited` 时该进程创建的帧流与句柄全部失效；`ready` 为新进程握手完成。 */
export type VideoDecoderLifecycleEvent = { type: 'ready'; pid: number } | { type: 'exited'; pid: number | undefined }

export interface VideoDecoderServiceOptions {
  resolveExecutable: () => string | null
  logger: Pick<MainLogger, 'debug' | 'info' | 'warn' | 'error'>
  spawn?: VideoDecoderSpawn
  handshakeTimeoutMs?: number
  requestTimeoutMs?: number
  shutdownTimeoutMs?: number
  restart?: Partial<VideoDecoderRestartPolicy>
  now?: () => number
  /** 纹理句柄复制目标（Electron 主进程）。默认当前进程。 */
  clientPid?: number
}

export interface VideoDecoderRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

interface PendingRequest {
  type: VideoDecoderCommand['type']
  resolve: (value: unknown) => void
  reject: (error: VideoDecoderError) => void
  cleanup: () => void
}

interface NativeLogLine {
  level?: unknown
  event?: unknown
  message?: unknown
  context?: unknown
}

const DEFAULT_RESTART_POLICY: VideoDecoderRestartPolicy = { maxRestarts: 3, windowMs: 60_000, backoffMs: [250, 1_000, 3_000] }
const NATIVE_LOG_EVENT = /^[a-z0-9_.]+$/

function defaultSpawn(executable: string): VideoDecoderChildProcess {
  return spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
}

function abortError(): VideoDecoderError {
  return new VideoDecoderError('CANCELLED', '视频解码请求已取消')
}

/**
 * 原生视频解码服务客户端：单实例长期驻留子进程，负责启动与握手、请求 ID 与超时、取消、
 * 退出检测与有限次自动重启，并把原生 stderr 的结构化日志转入主进程统一日志。
 */
export class VideoDecoderService {
  private readonly options: Required<Omit<VideoDecoderServiceOptions, 'restart'>> & { restart: VideoDecoderRestartPolicy }
  private stateValue: VideoDecoderServiceState = 'idle'
  private child: VideoDecoderChildProcess | null = null
  private generation = 0
  private startPromise: Promise<VideoDecoderHello> | null = null
  private helloValue: VideoDecoderHello | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private nextRequestId = 1
  private crashTimes: number[] = []
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private stderrTail = ''
  private readonly eventListeners = new Set<(event: VideoDecoderEvent) => void>()
  private readonly lifecycleListeners = new Set<(event: VideoDecoderLifecycleEvent) => void>()

  constructor(options: VideoDecoderServiceOptions) {
    this.options = {
      spawn: defaultSpawn,
      handshakeTimeoutMs: 10_000,
      requestTimeoutMs: 30_000,
      shutdownTimeoutMs: 3_000,
      now: Date.now,
      clientPid: process.pid,
      ...options,
      restart: { ...DEFAULT_RESTART_POLICY, ...options.restart },
    }
  }

  get state(): VideoDecoderServiceState {
    return this.stateValue
  }

  /** 读取当前状态的方法形式：避免 TS 对字段的控制流收窄掩盖 await 期间发生的状态变化。 */
  private isStopped(): boolean {
    return this.stateValue === 'stopped'
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  /** 启动（如未启动）并返回握手信息。 */
  async ensureStarted(): Promise<VideoDecoderHello> {
    if (this.stateValue === 'stopped') throw new VideoDecoderError('STOPPED', '原生视频解码服务已关闭')
    if (this.stateValue === 'ready' && this.helloValue) return this.helloValue
    if (this.stateValue === 'failed') {
      const lastCrash = this.crashTimes[this.crashTimes.length - 1] ?? 0
      if (this.options.now() - lastCrash < this.options.restart.windowMs) {
        throw new VideoDecoderError('UNAVAILABLE', '原生视频解码服务多次异常退出，暂时不可用')
      }
      // 冷却期已过，允许按需重新启动一次。
      this.crashTimes = []
    }
    return this.beginLaunch()
  }

  /** 同一时刻只有一次启动；失败后清空，下一次请求或计划重启可以重新启动。 */
  private beginLaunch(): Promise<VideoDecoderHello> {
    if (this.startPromise) return this.startPromise
    const promise = this.launch()
    this.startPromise = promise
    promise.catch(() => {
      if (this.startPromise === promise) this.startPromise = null
    })
    return promise
  }

  async probe(filePath: string, options: VideoDecoderRequestOptions = {}): Promise<VideoDecoderProbeResult> {
    return this.call<VideoDecoderProbeResult>({ type: 'probe', path: filePath }, options)
  }

  /** 原生服务主动发出的事件（帧就绪、流结束）。返回取消订阅函数。 */
  onEvent(listener: (event: VideoDecoderEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onLifecycle(listener: (event: VideoDecoderLifecycleEvent) => void): () => void {
    this.lifecycleListeners.add(listener)
    return () => this.lifecycleListeners.delete(listener)
  }

  async startTestStream(request: VideoDecoderTestStreamRequest, options: VideoDecoderRequestOptions = {}): Promise<VideoDecoderStreamStarted> {
    return this.call<VideoDecoderStreamStarted>({ type: 'start_test_stream', ...request }, options)
  }

  async stopStream(streamId: string, options: VideoDecoderRequestOptions = {}): Promise<VideoDecoderStreamStopped> {
    return this.call<VideoDecoderStreamStopped>({ type: 'stop_stream', streamId }, options)
  }

  async stats(options: VideoDecoderRequestOptions = {}): Promise<VideoDecoderStats> {
    return this.call<VideoDecoderStats>({ type: 'stats' }, options)
  }

  /** 关闭上一个服务进程遗留在本进程里的纹理句柄（服务异常退出后调用）。 */
  async closeClientHandles(handles: string[], options: VideoDecoderRequestOptions = {}): Promise<{ closed: number; failed: string[] }> {
    return this.call<{ closed: number; failed: string[] }>({ type: 'close_client_handles', handles }, options)
  }

  /**
   * 发送不等待响应的通知（如 release_frame）。只发给当前就绪的进程；进程已退出时返回 false，
   * 由调用方按生命周期事件统一回收。
   */
  notify(notification: VideoDecoderNotification): boolean {
    const child = this.child
    if (!child || this.stateValue !== 'ready') return false
    this.writeCommand(child, this.allocateId(), notification)
    return true
  }

  /** 主动关闭：发送 shutdown，超时后强制结束。关闭后实例不可再用。 */
  async shutdown(): Promise<void> {
    if (this.stateValue === 'stopped') return
    this.stateValue = 'stopped'
    this.clearRestartTimer()
    const child = this.child
    if (!child) {
      this.rejectAll(new VideoDecoderError('STOPPED', '原生视频解码服务已关闭'))
      return
    }
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    const id = this.allocateId()
    this.writeCommand(child, id, { type: 'shutdown' })
    const timer = setTimeout(() => child.kill(), this.options.shutdownTimeoutMs)
    await exited
    clearTimeout(timer)
    this.options.logger.info('原生视频解码服务已关闭', { event: 'video_decoder.service.stopped', context: { pid: child.pid } })
  }

  private async call<T>(command: VideoDecoderCommand, options: VideoDecoderRequestOptions): Promise<T> {
    if (options.signal?.aborted) throw abortError()
    await this.ensureStarted()
    if (options.signal?.aborted) throw abortError()
    const child = this.child
    if (!child) throw new VideoDecoderError('PROCESS_EXITED', '原生视频解码服务已退出')
    return (await this.send(child, command, options.timeoutMs ?? this.options.requestTimeoutMs, options.signal)) as T
  }

  private allocateId(): string {
    const id = `vd-${this.nextRequestId}`
    this.nextRequestId += 1
    return id
  }

  private writeCommand(child: VideoDecoderChildProcess, id: string, command: VideoDecoderCommand | VideoDecoderNotification): void {
    if (child.stdin.destroyed || !child.stdin.writable) return
    child.stdin.write(encodeVideoDecoderFrame({ id, ...command }))
  }

  private send(child: VideoDecoderChildProcess, command: VideoDecoderCommand, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const id = this.allocateId()
    return new Promise<unknown>((resolve, reject) => {
      const startedAt = this.options.now()
      const cancelNative = () => {
        if (command.type === 'probe') this.writeCommand(child, this.allocateId(), { type: 'cancel', targetId: id })
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        cleanup()
        cancelNative()
        this.options.logger.warn('原生视频解码请求超时', { event: 'video_decoder.request.timeout', context: { requestId: id, type: command.type, timeoutMs } })
        reject(new VideoDecoderError('TIMEOUT', `原生视频解码服务响应超时（${timeoutMs}ms）`))
      }, timeoutMs)
      const onAbort = () => {
        this.pending.delete(id)
        cleanup()
        cancelNative()
        this.options.logger.debug('原生视频解码请求已取消', { event: 'video_decoder.request.cancelled', context: { requestId: id, type: command.type } })
        reject(abortError())
      }
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        type: command.type,
        resolve: (value) => {
          this.options.logger.debug('原生视频解码请求完成', { event: 'video_decoder.request.completed', context: { requestId: id, type: command.type, elapsedMs: this.options.now() - startedAt } })
          resolve(value)
        },
        reject,
        cleanup,
      })
      this.writeCommand(child, id, command)
    })
  }

  private async launch(): Promise<VideoDecoderHello> {
    const executable = this.options.resolveExecutable()
    if (!executable) {
      this.stateValue = 'unavailable'
      this.options.logger.warn('原生视频解码服务未安装', { event: 'video_decoder.service.unavailable' })
      throw new VideoDecoderError('UNAVAILABLE', '原生视频解码服务尚未安装')
    }
    this.stateValue = this.crashTimes.length > 0 ? 'restarting' : 'starting'
    const generation = ++this.generation
    const startedAt = this.options.now()
    this.options.logger.info('启动原生视频解码服务', { event: 'video_decoder.service.start', context: { executable, generation } })
    let child: VideoDecoderChildProcess
    try {
      child = this.options.spawn(executable)
    } catch (error) {
      this.handleChildGone(generation, null, { error })
      throw new VideoDecoderError('START_FAILED', `原生视频解码服务启动失败：${error instanceof Error ? error.message : String(error)}`)
    }
    this.child = child
    this.stderrTail = ''
    this.attach(child, generation)
    try {
      const hello = (await this.send(child, { type: 'hello', clientPid: this.options.clientPid }, this.options.handshakeTimeoutMs)) as VideoDecoderHello
      if (hello?.service !== 'henji-video-decoder' || hello.protocolVersion !== VIDEO_DECODER_PROTOCOL_VERSION) {
        throw new VideoDecoderError('HANDSHAKE_FAILED', `原生视频解码服务协议不匹配（${String(hello?.protocolVersion)}）`)
      }
      if (generation !== this.generation || this.isStopped()) {
        throw new VideoDecoderError('STOPPED', '原生视频解码服务已关闭')
      }
      this.helloValue = hello
      this.stateValue = 'ready'
      this.logReady(hello, this.options.now() - startedAt)
      this.emitLifecycle({ type: 'ready', pid: hello.pid })
      return hello
    } catch (error) {
      const failure = error instanceof VideoDecoderError ? error : new VideoDecoderError('HANDSHAKE_FAILED', String(error))
      if (generation === this.generation && this.child === child && !this.isStopped()) {
        this.options.logger.error('原生视频解码服务握手失败', { event: 'video_decoder.service.handshake_failed', error: failure, context: { code: failure.code } })
        // 结束本次进程；退出事件会按重启策略处理。
        child.kill()
      }
      throw failure.code === 'TIMEOUT' ? new VideoDecoderError('HANDSHAKE_FAILED', failure.message) : failure
    }
  }

  private logReady(hello: VideoDecoderHello, handshakeMs: number): void {
    const d3d11 = hello.d3d11
    this.options.logger.info('原生视频解码服务已就绪', {
      event: 'video_decoder.service.ready',
      context: {
        pid: hello.pid,
        serviceVersion: hello.serviceVersion,
        handshakeMs,
        ffmpegVersion: hello.ffmpeg.version,
        libavcodec: hello.ffmpeg.libavcodec,
        libavformat: hello.ffmpeg.libavformat,
        license: hello.ffmpeg.license,
        gplEnabled: hello.ffmpeg.gplEnabled,
        requiredDecoders: hello.ffmpeg.requiredDecoders.filter((name) => !hello.ffmpeg.missingRequiredDecoders.includes(name)),
        missingRequiredDecoders: hello.ffmpeg.missingRequiredDecoders,
        videoDecoderCount: hello.ffmpeg.videoDecoders.length,
        audioDecoderCount: hello.ffmpeg.audioDecoders.length,
        videoDecoders: hello.ffmpeg.videoDecoders,
        hwDeviceTypes: hello.ffmpeg.hwDeviceTypes,
        d3d11: d3d11.available
          ? { adapter: d3d11.adapter.description, vendorId: d3d11.adapter.vendorId, deviceId: d3d11.adapter.deviceId, dedicatedVideoMemoryMiB: d3d11.adapter.dedicatedVideoMemoryMiB, featureLevel: d3d11.featureLevel, videoDecoderProfiles: d3d11.videoDecoderProfiles.named }
          : { available: false, reason: d3d11.reason },
      },
    })
    if (hello.ffmpeg.missingRequiredDecoders.length > 0) {
      this.options.logger.warn('FFmpeg 构建缺少必需解码器', { event: 'video_decoder.service.decoders_missing', context: { missing: hello.ffmpeg.missingRequiredDecoders } })
    }
  }

  private attach(child: VideoDecoderChildProcess, generation: number): void {
    const reader = new VideoDecoderFrameReader()
    child.stdout.on('data', (chunk: Buffer) => {
      if (generation !== this.generation) return
      let messages: unknown[]
      try {
        messages = reader.push(chunk)
      } catch (error) {
        this.options.logger.error('原生视频解码服务协议错误，结束进程', { event: 'video_decoder.protocol.error', error })
        child.kill()
        return
      }
      for (const message of messages) this.handleMessage(message)
    })
    let stderrBuffer = ''
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      this.stderrTail = (this.stderrTail + text).slice(-4096)
      stderrBuffer += text
      let newline = stderrBuffer.indexOf('\n')
      while (newline >= 0) {
        const line = stderrBuffer.slice(0, newline).trim()
        stderrBuffer = stderrBuffer.slice(newline + 1)
        if (line) this.forwardNativeLog(line, child.pid)
        newline = stderrBuffer.indexOf('\n')
      }
    })
    // 进程退出后写入会触发 EPIPE；退出由 exit 事件统一处理。
    child.stdin.on('error', () => undefined)
    child.once('error', (error) => this.handleChildGone(generation, child, { error }))
    child.once('exit', (code, signal) => this.handleChildGone(generation, child, { code, signal }))
  }

  private emitLifecycle(event: VideoDecoderLifecycleEvent): void {
    for (const listener of [...this.lifecycleListeners]) {
      try {
        listener(event)
      } catch (error) {
        this.options.logger.error('原生视频解码服务生命周期监听失败', { event: 'video_decoder.listener.failed', error, context: { type: event.type } })
      }
    }
  }

  private handleMessage(message: unknown): void {
    if (isVideoDecoderEvent(message)) {
      for (const listener of [...this.eventListeners]) {
        try {
          listener(message)
        } catch (error) {
          this.options.logger.error('原生视频解码事件处理失败', { event: 'video_decoder.listener.failed', error, context: { type: message.event } })
        }
      }
      return
    }
    if (!isVideoDecoderResponse(message)) {
      this.options.logger.warn('忽略无法识别的原生视频解码服务消息', { event: 'video_decoder.protocol.unknown_message' })
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return // 已超时或已取消的请求的迟到响应
    this.pending.delete(message.id)
    pending.cleanup()
    if (message.ok) {
      pending.resolve(message.result)
    } else {
      const code = nativeErrorCode(message.error?.code)
      if (pending.type !== 'hello') {
        this.options.logger.warn('原生视频解码请求失败', { event: 'video_decoder.request.failed', context: { requestId: message.id, type: pending.type, code } })
      }
      pending.reject(new VideoDecoderError(code, message.error?.message ?? '原生视频解码服务执行失败'))
    }
  }

  private forwardNativeLog(line: string, pid: number | undefined): void {
    let parsed: NativeLogLine | null = null
    try {
      const value: unknown = JSON.parse(line)
      if (value && typeof value === 'object') parsed = value as NativeLogLine
    } catch {
      parsed = null
    }
    if (!parsed) {
      this.options.logger.warn('原生视频解码服务输出了非结构化内容', { event: 'video_decoder.native.raw_output', context: { pid, line: line.slice(0, 2000) } })
      return
    }
    const nativeEvent = typeof parsed.event === 'string' && NATIVE_LOG_EVENT.test(parsed.event) ? parsed.event : 'unknown'
    const message = typeof parsed.message === 'string' ? parsed.message : nativeEvent
    const meta = { event: `video_decoder.native.${nativeEvent}`, context: { pid, ...(parsed.context && typeof parsed.context === 'object' ? parsed.context : {}) } }
    const level = parsed.level
    if (level === 'error') this.options.logger.error(message, meta)
    else if (level === 'warn') this.options.logger.warn(message, meta)
    else if (level === 'info') this.options.logger.info(message, meta)
    else this.options.logger.debug(message, meta)
  }

  private rejectAll(error: VideoDecoderError): void {
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const pending of entries) {
      pending.cleanup()
      pending.reject(error)
    }
  }

  private handleChildGone(
    generation: number,
    child: VideoDecoderChildProcess | null,
    detail: { code?: number | null; signal?: NodeJS.Signals | null; error?: unknown },
  ): void {
    if (generation !== this.generation) return
    if (child && this.child !== child) return
    this.child = null
    this.helloValue = null
    this.startPromise = null
    this.generation += 1 // 同一进程的 error 与 exit 只处理一次
    const intentional = this.stateValue === 'stopped'
    const startFailed = detail.error !== undefined
    this.rejectAll(intentional
      ? new VideoDecoderError('STOPPED', '原生视频解码服务已关闭')
      : new VideoDecoderError(startFailed ? 'START_FAILED' : 'PROCESS_EXITED', startFailed ? '原生视频解码服务启动失败' : '原生视频解码服务异常退出'))
    this.emitLifecycle({ type: 'exited', pid: child?.pid })
    if (intentional) return

    const now = this.options.now()
    this.crashTimes = [...this.crashTimes.filter((time) => now - time < this.options.restart.windowMs), now]
    const attempt = this.crashTimes.length
    this.options.logger.warn('原生视频解码服务异常退出', {
      event: startFailed ? 'video_decoder.service.start_failed' : 'video_decoder.service.exited',
      error: detail.error,
      context: { pid: child?.pid, code: detail.code ?? null, signal: detail.signal ?? null, crashesInWindow: attempt, stderrTail: this.stderrTail.slice(-1024) },
    })
    if (attempt > this.options.restart.maxRestarts) {
      this.stateValue = 'failed'
      this.options.logger.error('原生视频解码服务重启次数超限，停止自动重启', {
        event: 'video_decoder.service.restart_exhausted',
        context: { maxRestarts: this.options.restart.maxRestarts, windowMs: this.options.restart.windowMs },
      })
      return
    }
    const backoff = this.options.restart.backoffMs
    const delayMs = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0
    this.stateValue = 'restarting'
    this.options.logger.warn('计划重启原生视频解码服务', { event: 'video_decoder.service.restart_scheduled', context: { attempt, delayMs } })
    this.clearRestartTimer()
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.stateValue !== 'restarting') return
      // 重启失败已由退出处理记录并计入策略，这里只防止未处理的拒绝。
      this.beginLaunch().catch(() => undefined)
    }, delayMs)
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }
}
