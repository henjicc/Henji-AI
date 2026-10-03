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
  type VideoDecoderAudioOpened,
  type VideoDecoderAudioOpenRequest,
  type VideoDecoderAudioRead,
  type VideoDecoderCommand,
  type VideoDecoderDecoderStarted,
  type VideoDecoderEvent,
  type VideoDecoderFrameAtResult,
  type VideoDecoderHello,
  type VideoDecoderLimitOverrides,
  type VideoDecoderNotification,
  type VideoDecoderOpenRequest,
  type VideoDecoderProbeResult,
  type VideoDecoderScheduleAck,
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
  /**
   * 心跳（3.1）：就绪后每隔 `heartbeatIntervalMs` 发一次 `ping`，单次等 `heartbeatTimeoutMs`；连续 `heartbeatMisses`
   * 次没有回应即判定主循环卡死，结束进程并按崩溃重启。间隔为 0 关闭。
   */
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  heartbeatMisses?: number
  /** 每次启动时读取的资源上限覆盖（开发诊断），随 hello 发给原生服务。 */
  limits?: () => VideoDecoderLimitOverrides | undefined
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
/**
 * 交互类请求的默认超时（3.1）：超时即视为该会话或服务出了故障，由调用方关闭会话并重试或回退，而不是让预览等 30 秒。
 * 依据：单帧取帧冷启动最慢约 1 秒（长 GOP 4K，1.3 实测 0.83–0.98s），打开会话含解出首帧（1.3 实测 setup ≤0.5s，
 * 慢盘放宽），声音读取每次 ≤2 秒（实测 4–8ms）。
 */
const COMMAND_TIMEOUT_MS: Partial<Record<VideoDecoderCommand['type'], number>> = {
  frame_at: 8_000,
  open_decoder: 20_000,
  open_audio: 20_000,
  read_audio: 10_000,
  schedule: 5_000,
  cancel_schedule: 5_000,
  close_audio: 5_000,
}

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
  private readonly options: Required<Omit<VideoDecoderServiceOptions, 'restart' | 'limits'>> & { restart: VideoDecoderRestartPolicy; limits?: VideoDecoderServiceOptions['limits'] }
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
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatInFlight = false
  private heartbeatMissed = 0
  /** Why the client ended the current process itself (logged with its exit). */
  private killReason: 'hung' | null = null

  constructor(options: VideoDecoderServiceOptions) {
    this.options = {
      spawn: defaultSpawn,
      handshakeTimeoutMs: 10_000,
      requestTimeoutMs: 30_000,
      shutdownTimeoutMs: 3_000,
      now: Date.now,
      clientPid: process.pid,
      heartbeatIntervalMs: 1_000,
      heartbeatTimeoutMs: 1_500,
      heartbeatMisses: 2,
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

  /** 打开解码会话：原生服务打开文件并解出第一帧后才响应（大文件或慢盘可能较久）。 */
  async openDecoder(request: VideoDecoderOpenRequest, options: VideoDecoderRequestOptions = {}): Promise<VideoDecoderDecoderStarted> {
    return this.call<VideoDecoderDecoderStarted>({ type: 'open_decoder', ...request }, options)
  }

  /** 按时间取单帧：命中时 `frame` 事件先于响应到达。 */
  async frameAt(streamId: string, time: number, ticket: string, options: VideoDecoderRequestOptions = {}): Promise<VideoDecoderFrameAtResult> {
    return this.call<VideoDecoderFrameAtResult>({ type: 'frame_at', streamId, time, ticket }, options)
  }

  async schedule(request: { streamId: string; scheduleId: string; times?: number[]; range?: { from: number; to?: number } }, options: VideoDecoderRequestOptions = {}): Promise<VideoDecoderScheduleAck> {
    return this.call<VideoDecoderScheduleAck>({ type: 'schedule', ...request }, options)
  }

  async cancelSchedule(streamId: string, scheduleId: string, options: VideoDecoderRequestOptions = {}): Promise<{ cancelled: boolean }> {
    return this.call<{ cancelled: boolean }>({ type: 'cancel_schedule', streamId, scheduleId }, options)
  }

  /** 打开声音会话（2.3）：解码并按需用 SoX 重采样到 `sampleRate`，输出平面 float32。 */
  async openAudio(request: VideoDecoderAudioOpenRequest, options: VideoDecoderRequestOptions = {}): Promise<VideoDecoderAudioOpened> {
    return this.call<VideoDecoderAudioOpened>({ type: 'open_audio', ...request }, options)
  }

  /** 读取输出采样网格上 [startFrame, startFrame + frames) 的 PCM；`data` 为响应的二进制附件。 */
  async readAudio(audioId: string, startFrame: number, frames: number, options: VideoDecoderRequestOptions = {}): Promise<VideoDecoderAudioRead & { data: Buffer }> {
    const read = await this.call<VideoDecoderAudioRead & { data?: Buffer }>({ type: 'read_audio', audioId, startFrame, frames }, options)
    if (!(read?.data instanceof Buffer)) throw new VideoDecoderError('PROTOCOL_ERROR', '原生视频解码服务的声音读取缺少数据')
    return read as VideoDecoderAudioRead & { data: Buffer }
  }

  async closeAudio(audioId: string, options: VideoDecoderRequestOptions = {}): Promise<{ closed: boolean }> {
    return this.call<{ closed: boolean }>({ type: 'close_audio', audioId }, options)
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
    this.stopHeartbeat()
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
    return (await this.send(child, command, options.timeoutMs ?? COMMAND_TIMEOUT_MS[command.type] ?? this.options.requestTimeoutMs, options.signal)) as T
  }

  /**
   * Heartbeat (3.1): a `ping` the native main loop answers at once. A request timing out only cancels that request;
   * only a main loop that stops answering for `heartbeatMisses` pings in a row is hung: the process is ended and
   * restarts like a crash, so every request it holds fails fast and callers recover on the new process.
   */
  private startHeartbeat(child: VideoDecoderChildProcess, generation: number): void {
    this.stopHeartbeat()
    const interval = this.options.heartbeatIntervalMs
    if (interval <= 0) return
    this.heartbeatMissed = 0
    const timer = setInterval(() => {
      if (generation !== this.generation || this.child !== child || this.stateValue !== 'ready') { clearInterval(timer); return }
      if (this.heartbeatInFlight) return
      this.heartbeatInFlight = true
      this.send(child, { type: 'ping' }, this.options.heartbeatTimeoutMs, undefined, true).then(
        () => { this.heartbeatMissed = 0 },
        (error: unknown) => {
          if (generation !== this.generation || this.child !== child || !(error instanceof VideoDecoderError) || error.code !== 'TIMEOUT') return
          this.heartbeatMissed += 1
          this.options.logger.warn('原生视频解码服务心跳未回应', { event: 'video_decoder.service.heartbeat_missed', context: { pid: child.pid, missed: this.heartbeatMissed, timeoutMs: this.options.heartbeatTimeoutMs } })
          if (this.heartbeatMissed < this.options.heartbeatMisses) return
          this.options.logger.error('原生视频解码服务无响应，结束进程后重启', { event: 'video_decoder.service.hung', context: { pid: child.pid, missed: this.heartbeatMissed, pendingRequests: this.pending.size } })
          this.heartbeatMissed = 0
          this.killReason = 'hung'
          child.kill()
        },
      ).finally(() => { this.heartbeatInFlight = false })
    }, interval)
    timer.unref?.()
    this.heartbeatTimer = timer
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.heartbeatInFlight = false
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

  /** `quiet`: no per-request logs (heartbeat pings; their outcome is logged by the heartbeat). */
  private send(child: VideoDecoderChildProcess, command: VideoDecoderCommand, timeoutMs: number, signal?: AbortSignal, quiet = false): Promise<unknown> {
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
        if (!quiet) this.options.logger.warn('原生视频解码请求超时', { event: 'video_decoder.request.timeout', context: { requestId: id, type: command.type, timeoutMs } })
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
          if (!quiet) this.options.logger.debug('原生视频解码请求完成', { event: 'video_decoder.request.completed', context: { requestId: id, type: command.type, elapsedMs: this.options.now() - startedAt } })
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
    this.killReason = null
    this.attach(child, generation)
    try {
      const limits = this.options.limits?.()
      const hello = (await this.send(child, { type: 'hello', clientPid: this.options.clientPid, ...(limits ? { limits } : {}) }, this.options.handshakeTimeoutMs)) as VideoDecoderHello
      if (hello?.service !== 'henji-video-decoder' || hello.protocolVersion !== VIDEO_DECODER_PROTOCOL_VERSION) {
        throw new VideoDecoderError('HANDSHAKE_FAILED', `原生视频解码服务协议不匹配（${String(hello?.protocolVersion)}）`)
      }
      if (generation !== this.generation || this.isStopped()) {
        throw new VideoDecoderError('STOPPED', '原生视频解码服务已关闭')
      }
      this.helloValue = hello
      this.stateValue = 'ready'
      this.logReady(hello, this.options.now() - startedAt)
      this.startHeartbeat(child, generation)
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
        limits: hello.limits ?? null,
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
      // 带二进制附件的响应（声音 PCM）：附件作为结果的 `data`。
      pending.resolve(message.binary ? { ...(message.result && typeof message.result === 'object' ? message.result : {}), data: message.binary } : message.result)
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
    this.stopHeartbeat()
    const killReason = this.killReason
    this.killReason = null
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
      context: { pid: child?.pid, code: detail.code ?? null, signal: detail.signal ?? null, reason: killReason ?? (startFailed ? 'start_failed' : 'exited'), crashesInWindow: attempt, stderrTail: this.stderrTail.slice(-1024) },
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
