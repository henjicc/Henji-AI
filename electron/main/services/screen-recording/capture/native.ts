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
/** 开始后等网格起点（第一帧到达）的上限；暂停、继续后等它们生效的上限（正常在三四帧内；来源丢着时原生不发这两个事件）。 */
const STARTED_TIMEOUT_MS = 10_000
const PAUSED_WAIT_MS = 500
const RESUMED_WAIT_MS = 1500
/** 来源丢失后等多久还没重新接上，才按“来源没了”结束录制。原生每秒找一次，采集短暂出错通常一两秒内就回来。 */
const SOURCE_LOST_GRACE_MS = 8000

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
 * 时间：网格起点与每帧的系统时刻都是采集进程的单调时钟（与主进程 hrtime 同一个计数器），经客户端的校准换算到主进程时钟。
 * 帧的系统时刻是它上屏的时刻，画面里的光标与窗口内容却是更早一点定下的（采集程序在准备时报这个提前量）。
 * 会话时钟上记的一律是“画面内容的时刻”：光标、点击这些事件记的是发生的时刻，按内容的时刻才对得上同一帧。
 * 起点、暂停、继续三处都经 contentUs / presentUs 换算，暂停与继续的时刻取采集进程按格给出的那一刻；
 * 停止时按时刻表把分片起点定准，暂停与合并按格号推出，见 native-timing。
 * 停止不换算，按此刻切：采集进程收到停止就把之前的格子立刻补齐，等不了还没上屏的那一帧，结尾少的不到一个刷新周期。
 */
export class NativeCaptureBackend implements ScreenCaptureBackend {
  private state: 'idle' | 'prepared' | 'recording' | 'paused' | 'ended' = 'idle'
  private unsubscribe: (() => void) | undefined
  private waiters = new Map<string, (event: ScreenCaptureEvent | undefined) => void>()
  private encoder = ''
  private codec: 'h264' | 'hevc' = 'h264'
  /** 原生同时录的剪辑代理（尺寸与剪辑 auto 档一致）；没录成为 null。 */
  private proxy: { width: number; height: number } | null = null
  private presentLeadUs = 0
  private spanIndex = -1
  private sinceUs: number | undefined
  /** 这次暂停里画面内容截到的时刻（主进程时钟）。 */
  private heldUs: number | undefined
  /** 采集进程报的暂停那一格（它的时钟）；继续时按两格之差接着走，暂停长度不受时钟校准抖动影响。 */
  private heldCellUs: number | undefined
  private unholding: Promise<number> | undefined
  private lostSinceUs: number | undefined
  private health = { droppedFrames: 0, repeatedFrames: 0, captureDropped: 0 }
  private watchdog: ReturnType<typeof setInterval> | undefined
  private finishing: Promise<void> | undefined
  private readonly name: string
  constructor(private readonly options: ScreenCaptureOptions, private readonly point: readonly [number, number], private readonly storage: CaptureStorage, private readonly deps: NativeDependencies) {
    this.name = `screen-${String(storage.manifest.spans.length).padStart(6, '0')}`
  }
  private get sessionId(): string { return this.storage.manifest.sessionId }
  stats(): GfxCaptureStats { return { restarts: 0, droppedFrames: this.health.droppedFrames + this.health.captureDropped, duplicatedFrames: this.health.repeatedFrames, encoder: this.encoder } }
  /** 正在录的这一段画面从哪一刻的内容起（开始后是网格起点，继续后是继续生效的那一格），主进程时钟。 */
  capturingSinceUs(): number | undefined { return this.state === 'recording' ? this.sinceUs : undefined }
  /** 来源此刻丢着（显示器断开、采集连续出错）时，画面是从哪一刻起没有的（主进程时钟；暂停在先就是暂停的那一刻）；录制若就此结束，会话到这一刻为止。 */
  sourceLostSinceUs(): number | undefined { return this.lostSinceUs === undefined ? undefined : Math.min(this.lostSinceUs, this.state === 'paused' ? this.heldUs ?? this.lostSinceUs : this.lostSinceUs) }
  /** 采集进程给的帧时刻（上屏时刻）→ 这张画面内容的时刻（主进程时钟）。 */
  private contentUs(nativeUs: number): number { return this.deps.client.toMainUs(nativeUs) - this.presentLeadUs }
  /** 反过来：画面内容要切在主进程时钟的这一刻，采集进程该切在哪个帧时刻。 */
  private presentUs(mainUs: number): number { return this.deps.client.toNativeUs(mainUs + this.presentLeadUs) }

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
      this.encoder = prepared.encoder; this.codec = prepared.codec; this.proxy = prepared.proxy ?? null; this.presentLeadUs = prepared.presentLeadUs ?? 0
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
    this.sinceUs = this.contentUs(event.originUs)
    span.monoUs = Math.max(0, this.sinceUs - this.deps.originUs)
    this.storage.manifest.encoding = { codec: this.codec, encoder: this.encoder, softwareFallback: false }
    await this.storage.save()
    clearInterval(this.watchdog)
    this.watchdog = setInterval(() => { void assertCaptureDiskSpace(this.storage.directory).catch((error: Error) => this.fail(error)) }, 2000)
    this.watchdog.unref?.()
    logger.info('屏幕采集开始', { event: 'recording.capture.start', context: { capturer: 'native', encoder: this.encoder, width: this.options.width, height: this.options.height, fps: this.options.fps, firstFrameLagUs: this.sinceUs - this.deps.nowUs() } })
    if (signal.aborted) throw new Error('录制已取消')
  }

  /**
   * 按下暂停（pressedUs，主进程时钟）就让画面停下，返回画面内容实际截到的时刻：采集进程从“内容不早于按下那一刻”的第一格起不再进文件，
   * 那一格的时刻就是这次暂停的起点。事件时钟与会话文档都用这个返回值，和时刻表推出的暂停是同一刻，不各记各的。
   * 采集进程没报出那一格（来源正丢着，格子本来就没在进文件）时退回按下的时刻。
   */
  async hold(pressedUs: number): Promise<number> {
    if (this.state !== 'recording') return this.heldUs ?? pressedUs
    const paused = this.lostTimer ? undefined : this.next<NativeEvent<'paused'>>('paused', PAUSED_WAIT_MS)
    await this.deps.client.request('pause', { sessionId: this.sessionId, atUs: this.presentUs(pressedUs) })
    if (this.state === 'recording') this.state = 'paused'
    const event = await paused
    this.heldCellUs = undefined
    if (event && event.reason !== 'sourceLost') { this.heldCellUs = event.atUs; return this.heldUs = this.contentUs(event.atUs) }
    logger.warn('采集进程没有报出暂停生效的那一格，暂停记在按下的时刻', { event: 'recording.capture.native.pause_unconfirmed', context: { sourceLost: Boolean(this.lostTimer) || event?.reason === 'sourceLost' } })
    return this.heldUs = pressedUs
  }

  async pause(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.state === 'recording') await this.hold(this.deps.nowUs())
  }

  /**
   * 按下继续就让画面续上，返回续上的那一格画面内容的时刻（主进程时钟）：事件时钟与会话文档从这一刻接着走。
   * 事件采集与各路一起续的那条路会同时来调，只向采集进程发一次。
   */
  unhold(): Promise<number> {
    return this.unholding ??= (async () => {
      const pressedUs = this.deps.nowUs()
      if (this.state !== 'paused') return this.sinceUs ?? pressedUs
      const resumed = this.next<NativeEvent<'resumed'>>('resumed', RESUMED_WAIT_MS)
      await this.deps.client.request('resume', { sessionId: this.sessionId, atUs: this.presentUs(pressedUs) })
      const event = await resumed
      // 画面从继续生效的那一格接着进文件。没等到它（没有格子真的停过，或来源还丢着）时事件时钟不扣时间，从暂停处接着走。
      if (!event) logger.warn('采集进程没有报出继续生效的那一格，事件时钟从暂停处接着走', { event: 'recording.capture.native.resume_unconfirmed', context: { sourceLost: Boolean(this.lostTimer) } })
      this.sinceUs = !event ? this.heldUs ?? pressedUs : this.heldUs !== undefined && this.heldCellUs !== undefined ? this.heldUs + (event.atUs - this.heldCellUs) : this.contentUs(event.atUs)
      this.heldUs = undefined
      if (this.state === 'paused') this.state = 'recording'
      return this.sinceUs
    })().finally(() => { this.unholding = undefined })
  }

  async resume(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.state === 'paused') await this.unhold()
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

  /** 文件已收尾：分片时长是文件时间轴的长度；起点改到第 0 帧画面内容的时刻（格 0 时刻加上时刻表里新画面相对格时刻的中位偏移，再换成内容的时刻）。 */
  private async seal(result: Pick<ScreenCaptureResult, 'frames' | 'encodedFrames' | 'proxyFrames' | 'droppedFrames' | 'repeatedFrames' | 'captureDropped'>): Promise<void> {
    this.health = { droppedFrames: result.droppedFrames, repeatedFrames: result.repeatedFrames, captureDropped: result.captureDropped }
    const span = this.storage.manifest.spans[this.spanIndex]
    if (!span) return
    if (result.frames > 0) {
      try {
        const timing = await readCaptureTiming(this.storage.file(span))
        if (timing) span.monoUs = Math.max(0, this.contentUs(timing.originUs + captureTimingLeadUs(timing)) - this.deps.originUs)
      } catch (error) { logger.warn('逐帧时刻表读不出，画面起点按网格起点', { event: 'recording.capture.native.timing_failed', error }) }
    }
    await this.storage.seal(span.index, Math.round(result.frames * 1e6 / this.options.fps))
    if (result.frames > 0 && this.proxy) await this.registerProxy(this.storage.file(span), this.proxy, result)
  }

  /** 代理是附带的：中途停掉（比主文件短）或登记失败都只记日志，剪辑需要时照常现转。 */
  private async registerProxy(source: string, size: { width: number; height: number }, result: Pick<ScreenCaptureResult, 'encodedFrames' | 'proxyFrames'>): Promise<void> {
    const proxy = source.replace(/\.mp4$/i, '.proxy.mp4')
    try {
      // 采集进程报了代理实际写进的帧数就直接比；老的采集程序不报，才去量两份文件的时长。
      if (result.proxyFrames !== undefined && result.proxyFrames !== result.encodedFrames) { logger.warn('录制的代理比原片短，不登记', { event: 'recording.capture.native.proxy_short', context: { frames: result.encodedFrames, proxyFrames: result.proxyFrames } }); return }
      if (result.proxyFrames === undefined) {
      const [main, picture] = await Promise.all([probeMediaDurationUs(source), probeMediaDurationUs(proxy)])
      if (Math.abs(main - picture) > 1.5e6 / this.options.fps) { logger.warn('录制的代理比原片短，不登记', { event: 'recording.capture.native.proxy_short', context: { mainUs: main, proxyUs: picture } }); return }
      }
      await (this.deps.adoptProxy ?? adoptRecordedVideoProxy)(source, proxy, size)
      logger.info('录制的代理已登记给剪辑', { event: 'recording.capture.native.proxy_adopted', context: size })
    } catch (error) { logger.warn('录制的代理没能登记，剪辑需要时再转', { event: 'recording.capture.native.proxy_failed', error }) }
  }

  private release(): void {
    clearInterval(this.watchdog)
    clearTimeout(this.lostTimer); this.lostTimer = undefined
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
    // 采集短暂出错后重新接上、显示器闪断，原生都会发 sourceLost 并很快发 sourceRestored，同一文件续录
    // （那段空档记在画面条目的 gaps 里，不算暂停）。等一会儿还没回来，才按“来源没了”正常停止收尾。
    if (event.event === 'sourceLost' && !this.lostTimer) { this.lostSinceUs = this.contentUs(event.atUs); this.waitForSource() }
    if (event.event === 'sourceRestored') this.lostSinceUs = undefined
    if (event.event === 'sourceRestored' && this.lostTimer) { clearTimeout(this.lostTimer); this.lostTimer = undefined; logger.info('录制的画面来源已重新接上，继续录', { event: 'recording.capture.native.source_restored' }) }
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
  private lostTimer: ReturnType<typeof setTimeout> | undefined

  /** 等来源回来。用户暂停着的时候不结束录制（暂停中本来就不录），接着等；继续之后还没回来才算来源没了。 */
  private waitForSource(): void {
    this.lostTimer = setTimeout(() => {
      this.lostTimer = undefined
      if (this.state === 'paused') this.waitForSource(); else this.sourceLost()
    }, SOURCE_LOST_GRACE_MS)
  }

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
