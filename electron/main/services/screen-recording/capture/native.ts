import type { ScreenCaptureBackend, ScreenCaptureOptions } from '../../../../../src/core/screenRecording/capture'
import { recordingEncoding, recordingKeyframes } from '../../../../../src/core/screenRecording/encoding'
import { createMainLogger } from '../../logging'
import type { NativeProcessLoss } from '../../native-process/client'
import type { GfxCaptureStats } from './gfxcapture'
import { ScreenCaptureError, screenCapturePreparedSchema, screenCaptureResultSchema, type ScreenCaptureClient, type ScreenCaptureEvent, type ScreenCaptureResult } from './native-client'
import { captureTimingLeadUs, readCaptureTiming } from './native-timing'
import { assertCaptureDiskSpace, probeMediaDurationUs, type CaptureStorage } from './storage'
import { videoProxySize } from '../../../../../src/core/videoEdit/proxy'
import { adoptRecordedVideoProxy } from '../../video/proxy-runtime'

const logger = createMainLogger('main.screen_recording.capture')
/** 开始后等网格起点（第一帧到达）的上限；继续后等“继续生效”的上限（暂停与继续落在同一格里时原生不发这两个事件）。 */
const STARTED_TIMEOUT_MS = 10_000
const RESUMED_WAIT_MS = 1500

type NativeEvent<T extends ScreenCaptureEvent['event']> = Extract<ScreenCaptureEvent, { event: T }>
interface NativeDependencies {
  client: Pick<ScreenCaptureClient, 'request' | 'subscribe' | 'toMainUs' | 'toNativeUs' | 'setActive'>
  /** 会话时钟零点（主进程时钟）。 */
  originUs: number
  /** 主进程时钟，与事件采集同一个。 */
  nowUs(): number
  failed(error: Error): void
  /** 被录的显示器断开：画面到此为止且已收尾，由调用方按停止收尾。 */
  sourceEnded?(): void
  /** 把录好的代理登记进剪辑的代理缓存；默认用剪辑的代理服务。 */
  adoptProxy?(source: string, proxy: string, size: { width: number; height: number }): Promise<unknown>
}

/**
 * 原生画面采集进程录整块显示器：采集直通硬件编码，一次录制一个画面文件，暂停在同一个文件里（文件里没有暂停的画面），
 * 旁边写逐帧时刻表与活动时间线。会话清单里仍是一个画面分片，文件名与分片一致，时刻表就在它旁边。
 *
 * 时间：网格起点与每帧上屏时刻都是采集进程的单调时钟（与主进程 hrtime 同一个计数器），经客户端的校准换算到主进程时钟。
 * 停止时按时刻表把分片起点定在“第 0 帧画面真正上屏的时刻”，暂停与合并按格号推出，见 native-timing。
 */
export class NativeCaptureBackend implements ScreenCaptureBackend {
  private state: 'idle' | 'prepared' | 'recording' | 'paused' | 'ended' = 'idle'
  private unsubscribe: (() => void) | undefined
  private waiters = new Map<string, (event: ScreenCaptureEvent | undefined) => void>()
  private encoder = ''
  private codec: 'h264' | 'hevc' = 'h264'
  /** 原生同时录的剪辑代理（尺寸与剪辑 auto 档一致）；没录成为 null。 */
  private proxy: { width: number; height: number } | null = null
  private spanIndex = -1
  private sinceUs: number | undefined
  private pressedUs: number | undefined
  private lastPaused: NativeEvent<'paused'> | undefined
  private health = { droppedFrames: 0, repeatedFrames: 0, captureDropped: 0 }
  private watchdog: ReturnType<typeof setInterval> | undefined
  private finishing: Promise<void> | undefined
  private readonly name: string
  constructor(private readonly options: ScreenCaptureOptions, private readonly point: readonly [number, number], private readonly storage: CaptureStorage, private readonly deps: NativeDependencies) {
    this.name = `screen-${String(storage.manifest.spans.length).padStart(6, '0')}`
  }
  private get sessionId(): string { return this.storage.manifest.sessionId }
  stats(): GfxCaptureStats { return { restarts: 0, droppedFrames: this.health.droppedFrames + this.health.captureDropped, duplicatedFrames: this.health.repeatedFrames, encoder: this.encoder } }
  /** 正在录的画面此刻的第一帧（开始后是网格起点，继续后是按跳过的格数接着走的时刻），主进程时钟。 */
  capturingSinceUs(): number | undefined { return this.state === 'recording' ? this.sinceUs : undefined }
  /** 按下暂停的时刻（事件时钟在这一刻停）：画面的暂停也从这一刻起算，两边扣掉的长度才一样。 */
  pressed(atUs: number): void { this.pressedUs = atUs }

  async prepare(): Promise<void> {
    this.unsubscribe = this.deps.client.subscribe(this.sessionId, event => this.receive(event), loss => this.lost(loss))
    const encoding = recordingEncoding(this.options)
    try {
      const prepared = screenCapturePreparedSchema.parse(await this.deps.client.request('prepare', {
        sessionId: this.sessionId, directory: this.storage.directory, name: this.name,
        source: { kind: 'display', point: [Math.round(this.point[0]), Math.round(this.point[1])] }, fps: this.options.fps, codec: encoding.codec,
        rateControl: encoding.rateControl, bitrate: encoding.bitrate, keyframeFrames: recordingKeyframes(encoding.keyframeFrames).gop,
        // 代理按剪辑 auto 档的尺寸录：导入剪辑后查代理直接命中。来源不比它高时原生不录。
        proxy: { height: videoProxySize(this.options.width, this.options.height, 'auto').height },
      }))
      this.state = 'prepared'
      // 原生按显示器原尺寸录、不缩放：尺寸对不上（缩放比例变了等）就交还给现有录法。
      if (prepared.width !== this.options.width || prepared.height !== this.options.height) {
        await this.deps.client.request('cancel', { sessionId: this.sessionId }).catch(() => undefined)
        this.state = 'idle'
        throw new ScreenCaptureError('CAPTURE_UNSUPPORTED', `显示器实际尺寸 ${prepared.width}×${prepared.height} 与录制尺寸 ${this.options.width}×${this.options.height} 不同`)
      }
      this.encoder = prepared.encoder; this.codec = prepared.codec; this.proxy = prepared.proxy ?? null
      this.deps.client.setActive(true)
    } catch (error) { this.release(); throw error }
  }

  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.state !== 'prepared') throw new Error('原生画面采集没有准备好')
    await assertCaptureDiskSpace(this.storage.directory)
    // 恢复入口先于画面落盘：进程或应用此后任何时候崩溃，这个文件都找得回来。起点等网格定下后再改准。
    const span = await this.storage.openSpan(this.deps.nowUs() - this.deps.originUs, true)
    if (span.file !== `${this.name}.mp4`) throw new Error('原生画面文件与会话分片不一致')
    this.spanIndex = span.index
    const started = this.next<NativeEvent<'started'>>('started', STARTED_TIMEOUT_MS)
    await this.deps.client.request('start', { sessionId: this.sessionId })
    const event = await started
    if (!event) throw new ScreenCaptureError('CAPTURE_FAILED', '原生画面采集开始后没有收到画面')
    this.state = 'recording'
    this.sinceUs = this.deps.client.toMainUs(event.originUs)
    span.monoUs = Math.max(0, this.sinceUs - this.deps.originUs)
    this.storage.manifest.encoding = { codec: this.codec, encoder: this.encoder, softwareFallback: false }
    await this.storage.save()
    clearInterval(this.watchdog)
    this.watchdog = setInterval(() => { void assertCaptureDiskSpace(this.storage.directory).catch((error: Error) => this.fail(error)) }, 2000)
    this.watchdog.unref?.()
    logger.info('屏幕采集开始', { event: 'recording.capture.start', context: { capturer: 'native', encoder: this.encoder, width: this.options.width, height: this.options.height, fps: this.options.fps, firstFrameLagUs: this.sinceUs - this.deps.nowUs() } })
    if (signal.aborted) throw new Error('录制已取消')
  }

  async pause(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.state !== 'recording') return
    const at = this.pressedUs ?? this.deps.nowUs()
    this.pressedUs = at; this.lastPaused = undefined
    await this.deps.client.request('pause', { sessionId: this.sessionId, atUs: this.deps.client.toNativeUs(at) })
    this.state = 'paused'
  }

  async resume(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.state !== 'paused') return
    const resumed = this.next<NativeEvent<'resumed'>>('resumed', RESUMED_WAIT_MS)
    await this.deps.client.request('resume', { sessionId: this.sessionId, atUs: this.deps.client.toNativeUs(this.deps.nowUs()) })
    const event = await resumed
    const pressed = this.pressedUs ?? this.deps.nowUs()
    // 画面跳过了多少格，事件时钟就扣掉多长：从按下暂停的时刻起加上跳过的格时长。没有格子被暂停（暂停与继续在同一格里）时不扣。
    this.sinceUs = event && this.lastPaused ? pressed + (event.atUs - this.lastPaused.atUs) : pressed
    this.pressedUs = undefined
    if (this.state === 'paused') this.state = 'recording'
  }

  stop(_signal: AbortSignal): Promise<void> { return this.finish('stop') }
  /** 录制宿主的“取消”只是释放、不导入：录过的画面按停止收尾保留；还没开始录时才让原生放掉采集（它会删掉空文件）。 */
  async cancel(): Promise<void> {
    await this.finish('cancel').catch(error => logger.warn('原生画面采集释放时收尾失败，已写文件保留', { event: 'recording.capture.native.release_failed', error }))
  }

  private finish(reason: 'stop' | 'cancel'): Promise<void> {
    return this.finishing ??= (async () => {
      clearInterval(this.watchdog)
      try {
        if (this.state === 'recording' || this.state === 'paused') {
          this.state = 'ended'
          const result = screenCaptureResultSchema.parse(await this.deps.client.request('stop', { sessionId: this.sessionId, atUs: this.deps.client.toNativeUs(this.deps.nowUs()) }))
          await this.seal(result)
        } else if (this.state === 'prepared') {
          this.state = 'ended'
          await this.deps.client.request('cancel', { sessionId: this.sessionId })
        }
      } finally { this.release() }
      logger.info('原生画面采集已收尾', { event: 'recording.capture.native.finished', context: { reason, ...this.stats() } })
    })()
  }

  /** 文件已收尾：分片时长是文件时间轴的长度；起点改到第 0 帧画面真正上屏的时刻（时刻表里新画面相对格时刻的中位偏移）。 */
  private async seal(result: Pick<ScreenCaptureResult, 'frames' | 'droppedFrames' | 'repeatedFrames' | 'captureDropped'>): Promise<void> {
    this.health = { droppedFrames: result.droppedFrames, repeatedFrames: result.repeatedFrames, captureDropped: result.captureDropped }
    const span = this.storage.manifest.spans[this.spanIndex]
    if (!span) return
    if (result.frames > 0) {
      try {
        const timing = await readCaptureTiming(this.storage.file(span))
        if (timing) span.monoUs = Math.max(0, this.deps.client.toMainUs(timing.originUs + captureTimingLeadUs(timing)) - this.deps.originUs)
      } catch (error) { logger.warn('逐帧时刻表读不出，画面起点按网格起点', { event: 'recording.capture.native.timing_failed', error }) }
    }
    await this.storage.seal(span.index, Math.round(result.frames * 1e6 / this.options.fps))
    if (result.frames > 0 && this.proxy) await this.registerProxy(this.storage.file(span), this.proxy)
  }

  /** 代理是附带的：中途停掉（比主文件短）或登记失败都只记日志，剪辑需要时照常现转。 */
  private async registerProxy(source: string, size: { width: number; height: number }): Promise<void> {
    const proxy = source.replace(/\.mp4$/i, '.proxy.mp4')
    try {
      const [main, picture] = await Promise.all([probeMediaDurationUs(source), probeMediaDurationUs(proxy)])
      if (Math.abs(main - picture) > 1.5e6 / this.options.fps) { logger.warn('录制的代理比原片短，不登记', { event: 'recording.capture.native.proxy_short', context: { mainUs: main, proxyUs: picture } }); return }
      await (this.deps.adoptProxy ?? adoptRecordedVideoProxy)(source, proxy, size)
      logger.info('录制的代理已登记给剪辑', { event: 'recording.capture.native.proxy_adopted', context: size })
    } catch (error) { logger.warn('录制的代理没能登记，剪辑需要时再转', { event: 'recording.capture.native.proxy_failed', error }) }
  }

  private release(): void {
    clearInterval(this.watchdog)
    this.unsubscribe?.(); this.unsubscribe = undefined
    for (const waiter of [...this.waiters.values()]) waiter(undefined)
    this.waiters.clear()
    this.deps.client.setActive(false)
  }

  private next<T extends ScreenCaptureEvent>(name: T['event'], timeoutMs: number): Promise<T | undefined> {
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.waiters.delete(name); resolve(undefined) }, timeoutMs)
      this.waiters.set(name, event => { clearTimeout(timer); this.waiters.delete(name); resolve(event as T | undefined) })
    })
  }

  private receive(event: ScreenCaptureEvent): void {
    if (event.event === 'health') this.health = { droppedFrames: event.droppedFrames, repeatedFrames: event.repeatedFrames, captureDropped: event.captureDropped }
    if (event.event === 'paused') this.lastPaused = event
    // 原生在显示器断开后会等它回来、同一文件续录；这里与现有录法一致，按“来源没了”正常停止收尾。
    // 续录那段空档在事件时钟与声音里并没有暂停，按暂停算会错开，所以不让它发生。
    if (event.event === 'sourceLost' || event.event === 'paused' && event.reason === 'sourceLost') this.sourceLost()
    if (event.event === 'sourceChanged') logger.warn('录制的显示器换了分辨率，画面等比缩放留黑边', { event: 'recording.capture.native.source_changed', context: { width: event.width, height: event.height, frame: event.frame } })
    if (event.event === 'interrupted') {
      const error = new ScreenCaptureError(event.error.code, event.error.message)
      const result = screenCaptureResultSchema.safeParse(event)
      this.finishing ??= (async () => {
        this.state = 'ended'
        clearInterval(this.watchdog)
        try { if (result.success) await this.seal(result.data) } finally { this.release() }
      })()
      void this.finishing.catch(failure => logger.error('原生画面采集中断后收尾失败，已写文件保留', { event: 'recording.capture.native.interrupted_cleanup_failed', error: failure }))
        .then(() => {
          logger.warn('原生画面采集中断', { event: 'recording.capture.native.interrupted', context: { code: error.code } })
          if (error.code === 'SOURCE_LOST') this.deps.sourceEnded?.(); else this.deps.failed(error)
        })
    }
    this.waiters.get(event.event)?.(event)
  }

  /** 录制中显示器断开：原生把网格停在那里，由调用方按停止收尾（已录部分照常保存）。 */
  private sourceLost(): void {
    if (this.state !== 'recording' && this.state !== 'paused') return
    logger.info('录制的显示器已断开，画面到此为止', { event: 'recording.capture.source.ended', context: { capturer: 'native' } })
    this.deps.sourceEnded?.()
  }

  private lost(loss: NativeProcessLoss): void {
    if (this.state === 'ended' || this.state === 'idle') return
    this.state = 'ended'
    this.release()
    // 文件按“被杀之后”处理：会话收尾时按文件里真实写到的画面补齐时长。
    this.finishing ??= Promise.resolve()
    this.deps.failed(new ScreenCaptureError(loss.code, loss.message))
  }

  private fail(error: Error): void {
    clearInterval(this.watchdog)
    this.deps.failed(error)
    void this.finish('stop').catch(failure => logger.error('录制清理失败', { event: 'recording.capture.cleanup.failed', error: failure }))
  }
}
