import fs from 'node:fs/promises'
import type { ScreenCaptureBackend, ScreenCaptureOptions } from '../../../../../src/core/screenRecording/capture'
import { recordingEncoding, recordingKeyframes } from '../../../../../src/core/screenRecording/encoding'
import { createMainLogger } from '../../logging'
import type { NativeProcessLoss } from '../../native-process/client'
import type { GfxCaptureStats } from './gfxcapture'
import { ScreenCaptureError, screenCapturePreparedSchema, screenCaptureResultSchema, type ScreenCaptureClient, type ScreenCaptureEvent, type ScreenCaptureResult } from './native-client'
import { captureTimingFirstFrameUs, readCaptureTiming } from './native-timing'
import { assertCaptureDiskSpace, probeMediaDurationUs, type CaptureStorage } from './storage'
import { videoProxySize } from '../../../../../src/core/videoEdit/proxy'
import { adoptRecordedVideoProxy } from '../../video/proxy-runtime'
import type { SharedTextureApi } from '../../video-decoder/texture-bridge'
import { CapturePreview, type CapturePreviewTarget } from './preview'

const logger = createMainLogger('main.screen_recording.capture')
/** 开始后等网格起点（第一帧到达）的上限；暂停、继续后等它们生效的上限（正常在三四帧内；来源丢着时原生不发这两个事件）。 */
const STARTED_TIMEOUT_MS = 10_000
const PAUSED_WAIT_MS = 500
const RESUMED_WAIT_MS = 1500
/** 来源丢失后等多久还没重新接上，才按“来源没了”结束录制。原生每秒找一次，采集短暂出错通常一两秒内就回来。 */
const SOURCE_LOST_GRACE_MS = 8000
/**
 * 这些原因中断后在同一次录制里另开一个画面文件接着录：显卡设备重置或被移除、编码或采集出错、采集进程退出或没有应答。
 * 编码会话绑在显卡设备上，设备换了就是另一路流，接不回原文件。磁盘满、写文件出错重开也没用，照旧按采集失败收尾。
 */
const REOPENABLE = new Set(['DEVICE_REMOVED', 'ENCODER_FAILED', 'CAPTURE_FAILED', 'PROCESS_EXITED', 'NOT_RESPONDING'])
/** 一分钟内续录超过这么多次就不再试，与 FFmpeg 录法的续录上限一致。 */
const MAX_REOPENS_PER_MINUTE = 5
/** 显卡刚重置完，设备与编码器可能还建不起来：隔这么久各试一次。 */
const REOPEN_DELAYS_MS = [0, 500, 1500, 3000]

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
  /** 采集中断后已经另开一个文件接着录。 */
  restarted?(info: { restarts: number; reason: string }): void
  /** 续录重试之间的等待；测试里换掉。 */
  sleep?(ms: number): Promise<void>
  /** 实时预览导入共享纹理用；不给就没有预览。 */
  sharedTexture?: SharedTextureApi
}

/**
 * 原生画面采集进程录整块显示器：采集直通硬件编码，一次录制一个画面文件，暂停在同一个文件里（文件里没有暂停的画面），
 * 旁边写逐帧时刻表与活动时间线。会话清单里是一个画面分片，文件名与分片一致，时刻表就在它旁边。
 * 采集中途中断（显卡重置、采集进程退出）时在同一次录制里另开一个分片接着录，两个分片之间那一两秒没有画面，如实留空；
 * 中断时正暂停着就等按下继续再开。
 *
 * 时间：网格起点与每帧的系统时刻都是采集进程的单调时钟（与主进程 hrtime 同一个计数器），经客户端的校准换算到主进程时钟。
 * 帧的系统时刻是它上屏的时刻，画面里的光标与窗口内容却是更早一点定下的（采集程序在准备时报这个提前量）。
 * 会话时钟上记的一律是“画面内容的时刻”：光标、点击这些事件记的是发生的时刻，按内容的时刻才对得上同一帧。
 * 起点、暂停、继续三处都经 contentUs / presentUs 换算，暂停与继续的时刻取采集进程按格给出的那一刻；
 * 停止时按时刻表把分片起点定准，暂停与合并按格号推出，见 native-timing。
 * 停止不换算，按此刻切：采集进程收到停止就把之前的格子立刻补齐，等不了还没上屏的那一帧，结尾少的不到一个刷新周期。
 */
export class NativeCaptureBackend implements ScreenCaptureBackend {
  private state: 'idle' | 'prepared' | 'recording' | 'paused' | 'reopening' | 'ended' = 'idle'
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
  /** 已经结束的那些分片的丢帧与重复帧。 */
  private carried = { droppedFrames: 0, repeatedFrames: 0, captureDropped: 0 }
  private watchdog: ReturnType<typeof setInterval> | undefined
  private finishing: Promise<void> | undefined
  /** 中断后正在另开一个分片；暂停、继续、停止都等它有了结果再做。 */
  private reopening: Promise<void> | undefined
  /** 中断时正暂停着：按下继续时再开新分片。 */
  private deferred = false
  private readonly reopenTimes: number[] = []
  private restarts = 0
  private name = ''
  private readonly preview: CapturePreview | undefined
  constructor(private readonly options: ScreenCaptureOptions, private readonly point: readonly [number, number], private readonly storage: CaptureStorage, private readonly deps: NativeDependencies) {
    this.preview = deps.sharedTexture ? new CapturePreview({ request: (type, payload) => this.deps.client.request(type, payload), sharedTexture: deps.sharedTexture, sessionId: () => this.sessionId }) : undefined
  }
  private get sessionId(): string { return this.storage.manifest.sessionId }
  /**
   * 录制页要实时画面：帧经 `route` 那条显卡帧通道送到 `target`；`route` 为 null 时关掉。
   * 返回预览画面的尺寸；没有预览（没给共享纹理、录制已结束、正在续录）时为 null，续录好了会自动接上。
   */
  async setPreview(target: CapturePreviewTarget, route: string | null): Promise<{ width: number; height: number } | null> {
    if (!this.preview) return null
    if (route === null) { await this.preview.close(); return null }
    if (this.state === 'ended' || this.state === 'idle') return null
    return this.preview.open(target, route, this.state !== 'reopening' && !this.deferred)
  }
  stats(): GfxCaptureStats {
    const sum = (key: keyof typeof this.health): number => this.carried[key] + this.health[key]
    return { restarts: this.restarts, droppedFrames: sum('droppedFrames') + sum('captureDropped'), duplicatedFrames: sum('repeatedFrames'), encoder: this.encoder }
  }
  /** 正在录的这一段画面从哪一刻的内容起（开始后是网格起点，继续后是继续生效的那一格），主进程时钟。 */
  capturingSinceUs(): number | undefined { return this.state === 'recording' ? this.sinceUs : undefined }
  /** 来源此刻丢着（显示器断开、采集连续出错）时，画面是从哪一刻起没有的（主进程时钟；暂停在先就是暂停的那一刻）；录制若就此结束，会话到这一刻为止。 */
  sourceLostSinceUs(): number | undefined { return this.lostSinceUs === undefined ? undefined : Math.min(this.lostSinceUs, this.state === 'paused' ? this.heldUs ?? this.lostSinceUs : this.lostSinceUs) }
  /** 采集进程给的帧时刻（上屏时刻）→ 这张画面内容的时刻（主进程时钟）。 */
  private contentUs(nativeUs: number): number { return this.deps.client.toMainUs(nativeUs) - this.presentLeadUs }
  /** 反过来：画面内容要切在主进程时钟的这一刻，采集进程该切在哪个帧时刻。 */
  private presentUs(mainUs: number): number { return this.deps.client.toNativeUs(mainUs + this.presentLeadUs) }

  async prepare(): Promise<void> {
    await this.connect()
    this.state = 'prepared'
  }

  /** 让采集进程准备好下一个画面分片（文件名取会话清单里的下一个分片号）：建好采集与编码、开始采集，但还不录。 */
  private async connect(): Promise<void> {
    this.name = `screen-${String(this.storage.manifest.spans.length).padStart(6, '0')}`
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
      // 原生按显示器原尺寸录、不缩放：尺寸对不上（缩放比例变了等）就交还给现有录法。
      if (prepared.width !== this.options.width || prepared.height !== this.options.height) {
        await this.deps.client.request('cancel', { sessionId: this.sessionId }).catch(() => undefined)
        throw new ScreenCaptureError('CAPTURE_UNSUPPORTED', `显示器实际尺寸 ${prepared.width}×${prepared.height} 与录制尺寸 ${this.options.width}×${this.options.height} 不同`)
      }
      this.encoder = prepared.encoder; this.codec = prepared.codec; this.proxy = prepared.proxy ?? null; this.presentLeadUs = prepared.presentLeadUs ?? 0
      this.deps.client.setActive(true)
    } catch (error) { this.release(); throw error }
  }

  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.state !== 'prepared') throw new Error('原生画面采集没有准备好')
    await this.begin()
    if (signal.aborted) throw new Error('录制已取消')
  }

  /** 准备好的这个分片开始录：先登记恢复入口，再等网格起点定下。 */
  private async begin(): Promise<void> {
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
    logger.info('屏幕采集开始', { event: 'recording.capture.start', context: { capturer: 'native', encoder: this.encoder, width: this.options.width, height: this.options.height, fps: this.options.fps, firstFrameLagUs: this.sinceUs - this.deps.nowUs(), span: span.index } })
  }

  /**
   * 采集中断了：收好中断的那个分片（`sealPrevious`），在同一次录制里另开一个分片接着录。事件时钟与声音都没有停，
   * 两个分片之间没有画面的那一段如实留空。中断时正暂停着就只收尾，等按下继续再开（暂停中本来就不录）。
   * 开不起来（多次重试仍失败、一分钟内中断太多次）才按采集失败结束，已录部分照常保存。
   */
  private reopen(reason: ScreenCaptureError, sealPrevious: () => Promise<void>): void {
    // 继续已经按下、正等采集进程报出续上的那一格时中断：用户要的是在录，不算暂停着。
    const paused = this.state === 'paused' && !this.unholding
    this.state = 'reopening'
    this.release()
    this.lostSinceUs = undefined
    logger.warn('原生画面采集中断，在同一次录制里另开一个分片接着录', { event: 'recording.capture.native.reopen.start', context: { code: reason.code, paused, restarts: this.restarts } })
    const opening = (async () => {
      await sealPrevious().catch(error => logger.error('中断的画面分片收尾失败，留给会话收尾按文件补齐', { event: 'recording.capture.native.interrupted_cleanup_failed', error }))
      for (const key of ['droppedFrames', 'repeatedFrames', 'captureDropped'] as const) { this.carried[key] += this.health[key]; this.health[key] = 0 }
      const now = Date.now()
      this.reopenTimes.push(now)
      while (this.reopenTimes[0] < now - 60_000) this.reopenTimes.shift()
      if (this.reopenTimes.length > MAX_REOPENS_PER_MINUTE) throw new ScreenCaptureError(reason.code, `${reason.message}；一分钟内多次续录都没能恢复，录制已停止，已录部分可以导入`)
      if (this.state !== 'reopening') return
      if (paused) { this.deferred = true; this.state = 'paused'; return }
      await this.reconnect(reason)
    })().catch(error => {
      if (this.state === 'ended') return
      this.state = 'ended'; this.release()
      // 续录途中用户按了停止：不再开新分片，按正常停止收尾。
      if (this.finishing) return
      this.finishing = Promise.resolve()
      logger.error('原生画面采集中断后没能接着录', { event: 'recording.capture.native.reopen.failed', error })
      this.deps.failed(error instanceof Error ? error : new Error(String(error)))
    }).finally(() => { if (this.reopening === opening) this.reopening = undefined })
    this.reopening = opening
  }

  private async reconnect(reason: ScreenCaptureError): Promise<void> {
    let failure: unknown
    for (const delay of REOPEN_DELAYS_MS) {
      if (delay) await (this.deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms))))(delay)
      if (this.state === 'ended' || this.finishing) throw reason
      try { await this.connect(); failure = undefined; break } catch (error) { failure = error }
    }
    if (failure) throw failure
    // 新分片没能开始（开始被拒、迟迟没有第一帧）：让采集进程把它停掉收好，不留一个没人管的采集在录。
    try { await this.begin() } catch (error) { await this.deps.client.request('stop', { sessionId: this.sessionId }).catch(() => undefined); throw error }
    this.restarts++
    this.preview?.resume()
    logger.info('原生画面采集已接着录', { event: 'recording.capture.native.reopen.completed', context: { restarts: this.restarts, span: this.spanIndex } })
    this.deps.restarted?.({ restarts: this.restarts, reason: reason.message })
  }

  /**
   * 按下暂停（pressedUs，主进程时钟）就让画面停下，返回画面内容实际截到的时刻：采集进程从“内容不早于按下那一刻”的第一格起不再进文件，
   * 那一格的时刻就是这次暂停的起点。事件时钟与会话文档都用这个返回值，和时刻表推出的暂停是同一刻，不各记各的。
   * 采集进程没报出那一格（来源正丢着，格子本来就没在进文件）时退回按下的时刻。
   */
  async hold(pressedUs: number): Promise<number> {
    await this.reopening
    if (this.state !== 'recording') return this.heldUs ?? pressedUs
    const paused = this.lostTimer ? undefined : this.next<NativeEvent<'paused'>>('paused', PAUSED_WAIT_MS)
    let event: NativeEvent<'paused'> | undefined
    try {
      await this.deps.client.request('pause', { sessionId: this.sessionId, atUs: this.presentUs(pressedUs) })
      if (this.state === 'recording') this.state = 'paused'
      event = await paused
    } catch (error) { if (!this.reopening) throw error }
    // 暂停还没生效采集就中断了：等新分片开好（或确定延后到继续时再开），再按那时的状态暂停。
    if (this.reopening) return this.hold(pressedUs)
    this.heldCellUs = undefined
    // 来源丢失、停摆造成的空档不是这次暂停生效的那一格。
    if (event && (event.reason ?? 'user') === 'user') { this.heldCellUs = event.atUs; return this.heldUs = this.contentUs(event.atUs) }
    logger.warn('采集进程没有报出暂停生效的那一格，暂停记在按下的时刻', { event: 'recording.capture.native.pause_unconfirmed', context: { sourceLost: Boolean(this.lostTimer) || event?.reason === 'sourceLost', reason: event?.reason ?? null } })
    return this.heldUs = pressedUs
  }

  async pause(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.reopening
    if (this.state === 'recording') await this.hold(this.deps.nowUs())
  }

  /**
   * 按下继续就让画面续上，返回续上的那一格画面内容的时刻（主进程时钟）：事件时钟与会话文档从这一刻接着走。
   * 事件采集与各路一起续的那条路会同时来调，只向采集进程发一次。
   */
  unhold(): Promise<number> {
    return this.unholding ??= (async () => {
      await this.reopening
      const pressedUs = this.deps.nowUs()
      if (this.state !== 'paused') return this.sinceUs ?? pressedUs
      if (this.deferred) {
        // 暂停期间采集中断过：这时才开新分片，画面从它的网格起点接着走。
        this.deferred = false; this.state = 'reopening'
        const opening = this.reconnect(new ScreenCaptureError('CAPTURE_FAILED', '暂停期间画面采集中断过'))
        // 这时按下停止也要等新分片开好再停，不能留一个没人管的采集在录。
        const settled = opening.then(() => undefined, () => undefined).finally(() => { if (this.reopening === settled) this.reopening = undefined })
        this.reopening = settled
        try { await opening } catch (error) { this.state = 'ended'; this.release(); this.finishing ??= Promise.resolve(); throw error }
        this.heldUs = undefined
        return this.sinceUs ?? pressedUs
      }
      const resumed = this.next<NativeEvent<'resumed'>>('resumed', RESUMED_WAIT_MS)
      let event: NativeEvent<'resumed'> | undefined
      try {
        await this.deps.client.request('resume', { sessionId: this.sessionId, atUs: this.presentUs(pressedUs) })
        event = await resumed
      } catch (error) { if (!this.reopening) throw error }
      if (this.reopening) {
        // 还没续上采集就中断了：画面要等新分片开好才有，事件时钟与会话文档都从新分片的起点接着走，暂停算到那一刻为止。
        await this.reopening
        const since = this.capturingSinceUs()
        if (since === undefined) throw new ScreenCaptureError('CAPTURE_FAILED', '画面采集中断后没能接着录')
        this.heldUs = undefined
        return since
      }
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
    await this.reopening
    if (this.state === 'paused') await this.unhold()
  }

  stop(_signal: AbortSignal): Promise<void> { return this.finish('stop') }
  /** 录制宿主的“取消”只是释放、不导入：录过的画面按停止收尾保留；还没开始录时才让原生放掉采集（它会删掉空文件）。 */
  async cancel(): Promise<void> {
    await this.finish('cancel').catch(error => logger.warn('原生画面采集释放时收尾失败，已写文件保留', { event: 'recording.capture.native.release_failed', error }))
  }

  private finish(reason: 'stop' | 'cancel'): Promise<void> {
    return this.finishing ??= (async () => {
      await this.reopening
      clearInterval(this.watchdog)
      // 采集进程收尾时关掉预览的句柄：发停止之前就不再导入它们。
      this.preview?.end()
      try {
        // 暂停期间中断过、还没开新分片：采集进程那边没有在录的东西，中断的那个分片已经收好。
        if (this.deferred) this.state = 'ended'
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

  /** 文件已收尾：分片时长是文件时间轴的长度；起点改到第 0 帧画面内容的时刻（它所在格的时刻加上时刻表里新画面相对格时刻的中位偏移，再换成内容的时刻）。 */
  private async seal(result: Pick<ScreenCaptureResult, 'frames' | 'encodedFrames' | 'proxyFrames' | 'droppedFrames' | 'repeatedFrames' | 'captureDropped'>, interrupted = false): Promise<void> {
    this.health = { droppedFrames: result.droppedFrames, repeatedFrames: result.repeatedFrames, captureDropped: result.captureDropped }
    const span = this.storage.manifest.spans[this.spanIndex]
    if (!span) return
    if (result.frames > 0) {
      try {
        const timing = await readCaptureTiming(this.storage.file(span))
        if (timing) span.monoUs = Math.max(0, this.contentUs(captureTimingFirstFrameUs(timing)) - this.deps.originUs)
      } catch (error) { logger.warn('逐帧时刻表读不出，画面起点按网格起点', { event: 'recording.capture.native.timing_failed', error }) }
    }
    let durationUs = Math.round(result.frames * 1e6 / this.options.fps)
    // 中断时还在编码队列里的几帧没有写进文件：以文件里真有的为准，不让分片比文件长。
    if (interrupted && result.frames > 0) durationUs = Math.min(durationUs, await probeMediaDurationUs(this.storage.file(span)).catch(() => durationUs))
    await this.storage.seal(span.index, durationUs)
    if (result.frames > 0 && this.proxy) await this.registerProxy(this.storage.file(span), this.proxy, result)
  }

  /** 代理是附带的：中途停掉（比主文件短）或登记失败都只记日志，剪辑需要时照常现转。 */
  private async registerProxy(source: string, size: { width: number; height: number }, result: Pick<ScreenCaptureResult, 'encodedFrames' | 'proxyFrames'>): Promise<void> {
    const proxy = source.replace(/\.mp4$/i, '.proxy.mp4')
    try {
      // 采集进程报了代理实际写进的帧数就直接比；老的采集程序不报，才去量两份文件的时长。
      if (result.proxyFrames !== undefined && result.proxyFrames !== result.encodedFrames) {
        logger.warn('录制的代理比原片短，不登记', { event: 'recording.capture.native.proxy_short', context: { frames: result.encodedFrames, proxyFrames: result.proxyFrames } })
        // 半截的代理没有用处（剪辑需要时按原片现转），不留着占磁盘。
        await fs.rm(proxy, { force: true })
        return
      }
      if (result.proxyFrames === undefined) {
      const [main, picture] = await Promise.all([probeMediaDurationUs(source), probeMediaDurationUs(proxy)])
      if (Math.abs(main - picture) > 1.5e6 / this.options.fps) { logger.warn('录制的代理比原片短，不登记', { event: 'recording.capture.native.proxy_short', context: { mainUs: main, proxyUs: picture } }); return }
      }
      await (this.deps.adoptProxy ?? adoptRecordedVideoProxy)(source, proxy, size)
      logger.info('录制的代理已登记给剪辑', { event: 'recording.capture.native.proxy_adopted', context: size })
    } catch (error) { logger.warn('录制的代理没能登记，剪辑需要时再转', { event: 'recording.capture.native.proxy_failed', error }) }
  }

  private release(): void {
    this.preview?.detach()
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
    if (event.event === 'preview') { this.preview?.frame(event); return }
    // 采集进程结束这次录制时会关掉预览的句柄。
    if (event.event === 'interrupted') this.preview?.detach()
    if (event.event === 'health') this.health = { droppedFrames: event.droppedFrames, repeatedFrames: event.repeatedFrames, captureDropped: event.captureDropped }
    // 采集短暂出错后重新接上、显示器闪断，原生都会发 sourceLost 并很快发 sourceRestored，同一文件续录
    // （那段空档记在画面条目的 gaps 里，不算暂停）。等一会儿还没回来，才按“来源没了”正常停止收尾。
    if (event.event === 'sourceLost' && !this.lostTimer) { this.lostSinceUs = this.contentUs(event.atUs); this.waitForSource() }
    if (event.event === 'sourceRestored') this.lostSinceUs = undefined
    if (event.event === 'sourceRestored' && this.lostTimer) { clearTimeout(this.lostTimer); this.lostTimer = undefined; logger.info('录制的画面来源已重新接上，继续录', { event: 'recording.capture.native.source_restored' }) }
    if (event.event === 'paused' && event.reason === 'stall') logger.warn('画面采集停摆过（休眠或长时间卡住），那段时间记成空档', { event: 'recording.capture.native.stalled', context: { frame: event.frame } })
    if (event.event === 'proxyStopped') logger.warn('编码持续跟不上，采集进程已停掉代理、只录主画面', { event: 'recording.capture.native.proxy_stopped', context: { reason: event.reason, frame: event.frame } })
    if (event.event === 'sourceChanged') logger.warn('录制的显示器换了分辨率，画面等比缩放留黑边', { event: 'recording.capture.native.source_changed', context: { width: event.width, height: event.height, frame: event.frame } })
    if (event.event === 'interrupted') {
      const error = new ScreenCaptureError(event.error.code, event.error.message)
      const result = screenCaptureResultSchema.safeParse(event)
      if (this.reopenable(error.code)) this.reopen(error, async () => { if (result.success) await this.seal(result.data, true) })
      else {
        this.finishing ??= (async () => {
          this.state = 'ended'
          clearInterval(this.watchdog)
          try { if (result.success) await this.seal(result.data, true) } finally { this.release() }
        })()
        void this.finishing.catch(failure => logger.error('原生画面采集中断后收尾失败，已写文件保留', { event: 'recording.capture.native.interrupted_cleanup_failed', error: failure }))
          .then(() => {
            logger.warn('原生画面采集中断', { event: 'recording.capture.native.interrupted', context: { code: error.code } })
            if (error.code === 'SOURCE_LOST') this.deps.sourceEnded?.(); else this.deps.failed(error)
          })
      }
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

  private reopenable(code: string): boolean { return REOPENABLE.has(code) && (this.state === 'recording' || this.state === 'paused') && !this.deferred && !this.finishing }

  private lost(loss: NativeProcessLoss): void {
    // 续录途中进程又没了：准备阶段在途的请求会被拒，由续录的重试接着处理；已经准备好、正等第一帧的不重试，立刻按没等到结束。
    if (this.state === 'reopening') { for (const waiter of [...this.waiters.values()]) waiter(undefined); return }
    if (this.state === 'ended' || this.state === 'idle') return
    // 采集进程没了：它正在写的分片不封口，会话收尾时按文件里真实写到的画面补齐；新分片由重新启动的进程接着录。
    if (this.reopenable(loss.code)) { this.reopen(new ScreenCaptureError(loss.code, loss.message), async () => undefined); return }
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
