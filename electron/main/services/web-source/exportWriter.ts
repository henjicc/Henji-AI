import { codeWebPixelSize } from '../../../../src/core/videoEdit/codeMaterial/webSource'
import { webTimeAtFrame, webTimeFrameAt, webTimeSegment, type WebTimeSegment } from '../../../../src/core/videoEdit/webTimeCache'
import type { WebSourceCaptureRequest, WebSourceCaptureResult } from '../../../../src/platform/contracts/videoFrameTypes'
import type { MainLogger } from '../logging/main-logger'
import { GpuFrameCapture } from '../web-replay/player/gpuCapture'
import type { WebCacheCapabilityGate } from './capability'
import type { WebCacheLocks } from './locks'
import type { WebSourcePage, ReliableWebSourceFrame } from './page'
import { publishWebTimeSegment, type WebCacheVariant } from './publication'
import type { WebCacheRegistration, WebCacheRegistrations } from './registration'
import { WebCacheSubmissions, waitWebCacheTask } from './submissions'

type Environment = NonNullable<Awaited<ReturnType<WebCacheRegistration['environment']>>>

/**
 * 读回中与排队待编码的像素上限（至少容两幅）。超过说明编码跟不上导出：放弃写缓存，不拖慢导出。
 * 平面444每幅宽×高×3字节，1080p约40幅、4K约10幅、8K只容两幅。
 */
const EXPORT_CACHE_BACKLOG_BYTES = 256 * 1024 * 1024
/**
 * 同时在读回的幅数。读回持有浏览器的共享纹理（池子约十幅），只多留一幅给慢的读回（首幅要编译读回管线，约半秒）。
 */
const MAX_READBACKS = 2
/** 编码跟不上后跳过的段数按次翻倍到此为止：网页轻重随时刻变化，重的片段导出变慢时仍有机会顺手写入。 */
const MAX_SKIPPED_SEGMENTS = 32
/** 来源关闭时收齐帧的段还要编码与发布；超过这么久仍未完成就放弃，不让离屏页面一直留着。 */
const DRAIN_TIMEOUT_MS = 30_000

/** 一段的可靠帧队列：导出只往里放、从不等待，编码器按序取；放弃本段时排队的帧立即释放。 */
class SegmentFeed {
  private readonly queue: Array<{ frame: ReliableWebSourceFrame; done(): void }> = []
  private receive?: () => void
  private failed = false
  private failure?: unknown

  async *frames(count: number): AsyncGenerator<ReliableWebSourceFrame> {
    for (let index = 0; index < count; index++) {
      while (!this.queue.length && !this.failed) await new Promise<void>(resolve => { this.receive = resolve })
      if (this.failed) throw this.failure
      const entry = this.queue.shift()!
      try { yield entry.frame } finally { entry.done() }
    }
  }
  push(frame: ReliableWebSourceFrame, done: () => void): void {
    if (this.failed) { done(); return }
    this.queue.push({ frame, done }); this.wake()
  }
  fail(error: unknown): void {
    if (!this.failed) { this.failed = true; this.failure = error }
    for (const entry of this.queue.splice(0)) entry.done()
    this.wake()
  }
  private wake(): void { this.receive?.(); this.receive = undefined }
}

interface Segment { key: string; range: WebTimeSegment; next: number; selectors: string[]; feed: SegmentFeed; controller: AbortController; done: Promise<void> }
interface Session {
  page: WebSourcePage; registration: WebCacheRegistration; environment: Environment; reader: GpuFrameCapture<'yuv444p'>; tail: Promise<void>
  /** 正在接收导出帧的段。 */
  segment?: Segment
  /** 尚未结束的段，含已收齐帧、仍在编码或发布的上一段。 */
  writing: Set<Segment>
  /** 读回链的末尾：各幅按导出顺序进队列；readings 是仍在读回的幅数。 */
  reading?: Promise<void>
  readings: number
  /** 已有一幅读回成功：此前的读回要编译管线，慢不说明跟不上。 */
  warm: boolean
  backlog: number
  /** 编码跟不上导出后还要跳过的段数，以及下次跟不上时要跳过的段数；段发布成功即复位。 */
  skip: number
  penalty: number
  closed: boolean; stop(): void
}
interface Options {
  registrations: WebCacheRegistrations
  capability: WebCacheCapabilityGate
  locks: WebCacheLocks
  cacheRoot(): string | undefined
  published(): void
  logger: Pick<MainLogger, 'debug' | 'info' | 'warn'>
  binaries?: { ffmpeg: string; ffprobe: string }
}

/**
 * 精确导出的画面立即交给节目合成；同一幅在后台读回、排队交给既有段发布器，导出从不等缓存写入。
 * 编码跟不上就放弃本段，不完整或身份不符的段由发布器拒绝，原子发布保证不变。
 */
export class WebCacheExportWriter {
  private readonly sessions = new Map<string, Promise<Session | undefined>>()
  /** 已开好的会话；开会话要拍字体快照、开读回窗口（首次可达十秒），在后台进行，没开好之前导出照常实时取帧。 */
  private readonly ready = new Map<string, Session>()
  /** 开会话抛错（如读回窗口没有 WebGPU）的来源：重试只会每幅新建窗口、重拍字体快照，本页关闭前不再尝试。 */
  private readonly unavailable = new Set<string>()
  private readonly requests = new Map<string, AbortController>()
  private readonly submissions: WebCacheSubmissions
  private disposed = false

  constructor(private readonly options: Options) { this.submissions = new WebCacheSubmissions(options.logger) }

  async capture(page: WebSourcePage, request: WebSourceCaptureRequest): Promise<WebSourceCaptureResult | undefined> {
    if (!request.cacheWrite || request.precision === 'web-cache' || !request.cacheGrid || request.latest || this.disposed
      || page.capturePath.captureMode !== 'html-in-canvas' || webTimeFrameAt(request.cacheGrid, request.time) === undefined) return undefined
    const key = `${page.streamId}\0${request.ticket}`, controller = new AbortController()
    this.requests.set(key, controller)
    const signal = AbortSignal.any([controller.signal, page.signal])
    let cleanup = (): void => undefined
    const dropped = (): WebSourceCaptureResult => ({ dropped: true, boxes: null, duration: page.duration, contentHash: page.contentHash, pixelWidth: page.pixelWidth, pixelHeight: page.pixelHeight })
    try {
      const session = this.ready.get(page.streamId)
      if (!session) { this.prepare(page); return undefined }
      if (session.closed || !session.registration.current || !await waitWebCacheTask(session.environment.current(), signal)) return signal.aborted ? dropped() : undefined
      // 取消的这一幅属于正在接收的段且还没取到：段已不可能收齐，立即放弃，不留着段锁与空闲编码器等下一幅来发现缺口。
      const frame = webTimeFrameAt(request.cacheGrid, request.time)!
      const cancelled = (): void => {
        const segment = session.segment
        if (segment && frame >= segment.next && frame < segment.range.firstFrame + segment.range.frameCount) this.abandon(session, segment, signal.reason)
      }
      signal.addEventListener('abort', cancelled, { once: true })
      cleanup = () => signal.removeEventListener('abort', cancelled)
      const work = session.tail.then(() => { signal.throwIfAborted(); return this.captureNow(session, request, signal) })
      session.tail = work.then(() => undefined, () => undefined)
      const result = await waitWebCacheTask(work, signal)
      return signal.aborted ? dropped() : result
    } catch (error) { if (signal.aborted) return dropped(); throw error }
    finally { cleanup(); if (this.requests.get(key) === controller) this.requests.delete(key) }
  }

  private prepare(page: WebSourcePage): void {
    if (this.sessions.has(page.streamId) || this.unavailable.has(page.streamId)) return
    const opening = this.open(page)
    this.sessions.set(page.streamId, opening)
    // 返回空（来源未登记、实探未完成、环境未就绪）不记住，下一幅再试；抛错记住，本页不再重开。
    void opening.then(session => {
      if (this.sessions.get(page.streamId) !== opening) return
      if (session) this.ready.set(page.streamId, session)
      else this.sessions.delete(page.streamId)
    }, error => {
      if (this.sessions.get(page.streamId) !== opening) return
      this.sessions.delete(page.streamId)
      this.unavailable.add(page.streamId)
      this.options.logger.warn('网页精确导出缓存不可用，继续实时取帧', { event: 'web_source.export_cache.failed', error, context: { streamId: page.streamId } })
    })
  }

  private async open(page: WebSourcePage): Promise<Session | undefined> {
    const registration = this.options.registrations.get(page.streamId)
    if (!registration || this.disposed) return undefined
    // 导出逐帧等着这一幅：硬件链路还没实探过就在后台探，本次照常实时取帧，不让导出等实探。
    if (this.options.capability.availableGeneration === undefined) { void this.options.capability.check().catch(() => undefined); return undefined }
    const environment = await registration.environment()
    if (!environment || !registration.current || this.disposed) { environment?.close(); return undefined }
    const reader = new GpuFrameCapture(0, 'yuv444p')
    try { await reader.open() } catch (error) { environment.close(); await reader.dispose(); throw error }
    const session: Session = { page, registration, environment, reader, tail: Promise.resolve(), writing: new Set(), readings: 0, warm: false, backlog: 0, skip: 0, penalty: 1, closed: false, stop: () => undefined }
    const stop = (): void => { void this.close(page.streamId) }
    registration.signal.addEventListener('abort', stop, { once: true })
    session.stop = () => registration.signal.removeEventListener('abort', stop)
    if (!registration.current || this.disposed) { session.closed = true; session.stop(); environment.close(); await reader.dispose(); return undefined }
    return session
  }

  private async captureNow(session: Session, request: WebSourceCaptureRequest, signal: AbortSignal): Promise<WebSourceCaptureResult | undefined> {
    if (session.closed || !session.registration.current) return undefined
    const { page, registration, environment } = session, grid = request.cacheGrid!
    const frame = webTimeFrameAt(grid, request.time)!, index = Math.floor(frame / webTimeSegment(grid, 0, null)!.frameCount)
    const range = webTimeSegment(grid, index, page.duration)
    if (!range) return undefined
    const view = { ...page.view, scale: request.scale ?? page.view.scale }, size = codeWebPixelSize(view)
    if (size.width < 8 || size.height < 4) return undefined
    const key = JSON.stringify([view, grid, index]), selectors = request.boxes ?? []
    let segment = session.segment
    if (segment && (segment.key !== key || segment.next !== frame || selectors.some(selector => !segment!.selectors.includes(selector)))) {
      this.abandon(session, segment, new Error('精确导出网页时刻或取景不连续'))
      segment = undefined
    }
    if (!segment) {
      // 不完整的段不能发布；等导出自然到达下一段首帧，不重演缺失部分。上一段仍在收尾时最多再开一段。
      if (frame !== range.firstFrame || !this.options.cacheRoot() || session.writing.size >= 2) return undefined
      if (session.skip > 0) { session.skip--; return undefined }
      segment = this.begin(session, key, range, { view, grid, deviceScaleFactor: view.scale, environmentSignature: environment.signature, chromium: process.versions.chrome }, selectors)
    }
    const current = segment, bytes = size.width * size.height * 3
    // 画面交付之后才判断这一幅能否进缓存：读回或积压已满，说明跟不上导出，放弃写缓存而不是等它。
    const admit = (): boolean => {
      if (session.closed || session.segment !== current || signal.aborted) return false
      if (session.readings < MAX_READBACKS && session.backlog + bytes <= Math.max(EXPORT_CACHE_BACKLOG_BYTES, bytes * 2)) return true
      // 首幅读回编译管线约半秒，这时排满只放弃本段，不退避后面的段。
      if (!session.warm) this.abandon(session, current, new Error('网页缓存读回尚在预热'))
      else this.fallBehind(session, current, bytes)
      return false
    }
    const captured = await page.captureExport(webTimeAtFrame(grid, frame), request.ticket, session.reader, selectors, AbortSignal.any([signal, registration.signal]), request.scale, admit)
    current.next++
    // 交付后快照已失效等原因没读回：段里留了缺口，不能让发布器空等下去。
    if (!captured.reliable && session.segment === current) this.abandon(session, current, new Error('精确导出网页画面没有进入缓存'))
    if (captured.reliable) {
      session.backlog += bytes; session.readings++
      const { reliable } = captured
      void reliable.then(() => { session.warm = true }, () => undefined).finally(() => { session.readings-- })
      // 两幅的读回可能乱序完成，按导出顺序串起来入队。
      const reading = (session.reading ?? Promise.resolve()).then(() => reliable).then(
        frame => current.feed.push(frame, () => { session.backlog -= bytes }),
        // 读回失败或身份不符：画面已经交付，只作废本段并退避，链路一直坏时不必每段都全量读回再失败。
        error => {
          session.backlog -= bytes
          if (session.closed) { this.abandon(session, current, error); return }
          const skip = this.backOff(session, current, error)
          this.options.logger.warn('精确导出的网页画面读回失败，放弃本段并跳过后面几段', { event: 'web_source.export_cache.read_failed', error, context: { streamId: page.streamId, segment: current.range.index, skipSegments: skip } })
        })
      session.reading = reading
      void reading.finally(() => { if (session.reading === reading) session.reading = undefined })
    }
    if (current.next === range.firstFrame + range.frameCount && session.segment === current) session.segment = undefined
    return { provenance: 'live', boxes: captured.boxes, duration: page.duration, contentHash: page.contentHash, pixelWidth: size.width, pixelHeight: size.height }
  }

  private begin(session: Session, key: string, range: WebTimeSegment, variant: WebCacheVariant, selectors: string[]): Segment {
    const controller = new AbortController(), feed = new SegmentFeed()
    const signal = AbortSignal.any([controller.signal, session.registration.signal])
    const segment: Segment = { key, range, next: range.firstFrame, selectors: [...selectors], feed, controller, done: Promise.resolve() }
    const abort = (): void => feed.fail(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    session.segment = segment
    session.writing.add(segment)
    segment.done = publishWebTimeSegment({ cacheRoot: this.options.cacheRoot()!, batch: session.registration.batch, variant, segment: range,
      ...codeWebPixelSize(variant.view), selectors, frames: () => feed.frames(range.frameCount),
      capability: this.options.capability, submissions: this.submissions, environmentCurrent: session.environment.current,
      signal, logger: this.options.logger, binaries: this.options.binaries,
      // 其他读者持有的段不阻塞精确导出，交给后台在空闲时补齐。
      withSegmentLock: (identity, work, active) => this.options.locks.withSegmentLock(identity, work, active, false),
    }).then(() => {
      session.penalty = 1
      this.options.published()
      this.options.logger.info('精确导出的网页画面已写入缓存', { event: 'web_source.export_cache.completed', context: { streamId: session.page.streamId, segment: range.index, frames: range.frameCount } })
    }).catch(error => {
      this.options.logger.debug('精确导出继续，网页缓存段未写入', { event: 'web_source.export_cache.skipped', context: { streamId: session.page.streamId, segment: range.index, reason: error instanceof Error ? error.message : String(error) } })
    }).finally(() => {
      // 发布器提前结束（复用已有段、门禁拒绝、失败）时，后续帧不再进这一段。
      feed.fail(new Error('网页缓存段已结束'))
      if (session.segment === segment) session.segment = undefined
      session.writing.delete(segment)
      signal.removeEventListener('abort', abort)
    })
    return segment
  }

  /** 放弃一段：不等编码器退出，发布器自行清理临时目录。 */
  private abandon(session: Session, segment: Segment, reason: unknown): void {
    segment.controller.abort(reason)
    segment.feed.fail(reason)
    if (session.segment === segment) session.segment = undefined
  }

  /** 放弃本段并跳过后面几段，跳过段数逐次翻倍；返回这次要跳过的段数。 */
  private backOff(session: Session, segment: Segment, reason: unknown): number {
    session.skip = session.penalty
    session.penalty = Math.min(session.penalty * 2, MAX_SKIPPED_SEGMENTS)
    this.abandon(session, segment, reason)
    return session.skip
  }

  private fallBehind(session: Session, segment: Segment, bytes: number): void {
    const context = { streamId: session.page.streamId, segment: segment.range.index, frame: segment.next, frameBytes: bytes, backlogBytes: session.backlog, readings: session.readings }
    const skip = this.backOff(session, segment, new Error('网页缓存写入跟不上精确导出'))
    this.options.logger.info('网页缓存写入跟不上精确导出，放弃本段并跳过后面几段', { event: 'web_source.export_cache.behind', context: { ...context, skipSegments: skip } })
  }

  /** 关闭来源：没收齐的段立即放弃；收齐帧的段只差编码与发布，等它们结束（最多 DRAIN_TIMEOUT_MS）再交还页面。 */
  close(streamId: string): Promise<void> | undefined {
    for (const [key, request] of this.requests) if (key.startsWith(`${streamId}\0`)) request.abort(new Error('精确导出网页来源已关闭'))
    const opening = this.sessions.get(streamId)
    this.sessions.delete(streamId)
    this.ready.delete(streamId)
    this.unavailable.delete(streamId)
    if (!opening) return undefined
    return opening.then(async session => {
      if (!session || session.closed) return
      session.closed = true
      await session.tail
      if (session.segment) this.abandon(session, session.segment, new Error('精确导出网页来源已关闭'))
      const timer = setTimeout(() => { for (const segment of session.writing) segment.controller.abort(new Error('网页缓存段收尾超时')) }, DRAIN_TIMEOUT_MS)
      try { await Promise.all([...session.writing].map(segment => segment.done)) } finally { clearTimeout(timer) }
      await session.reading
      session.stop(); session.environment.close(); await session.reader.dispose()
    }).catch(error => this.options.logger.warn('精确导出网页缓存会话关闭失败', { event: 'web_source.export_cache.close_failed', error, context: { streamId } }))
  }
  cancel(streamId: string, ticket: string): boolean {
    const controller = this.requests.get(`${streamId}\0${ticket}`)
    controller?.abort(new Error('精确导出网页取帧已取消'))
    return !!controller
  }
  dispose(): void {
    this.disposed = true
    for (const [streamId, opening] of this.sessions) {
      void opening.then(session => { if (session) for (const segment of session.writing) segment.controller.abort(new Error('精确导出网页缓存已停止')) }, () => undefined)
      void this.close(streamId)
    }
  }
}
