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
interface Sample { frame: ReliableWebSourceFrame; done(): void; failed(error: unknown): void }

/** 单帧背压：编码器写完才放行下一幅，绝不保留一整段4K原始像素。 */
class ExportFrames {
  private sample?: Sample
  private receive?: () => void
  private failure?: unknown
  private ready!: () => void
  readonly started = new Promise<void>(resolve => { this.ready = resolve })

  async *frames(count: number): AsyncGenerator<ReliableWebSourceFrame> {
    this.ready()
    for (let index = 0; index < count; index++) {
      while (!this.sample && !this.failure) await new Promise<void>(resolve => { this.receive = resolve })
      if (this.failure) throw this.failure
      const sample = this.sample!
      this.sample = undefined
      try { yield sample.frame } finally { sample.done() }
    }
  }
  push(frame: ReliableWebSourceFrame): Promise<void> {
    if (this.failure) return Promise.reject(this.failure)
    return new Promise((resolve, reject) => { this.sample = { frame, done: resolve, failed: reject }; this.receive?.(); this.receive = undefined })
  }
  fail(error: unknown): void { this.failure = error; this.sample?.failed(error); this.sample = undefined; this.receive?.(); this.receive = undefined }
}

interface Segment { key: string; range: WebTimeSegment; next: number; selectors: string[]; feed: ExportFrames; controller: AbortController; done: Promise<void>; finished: boolean }
interface Session { page: WebSourcePage; registration: WebCacheRegistration; environment: Environment; reader: GpuFrameCapture<'yuv444p'>; tail: Promise<void>; segment?: Segment; closed: boolean; stop(): void }
interface Options {
  registrations: WebCacheRegistrations
  capability: WebCacheCapabilityGate
  locks: WebCacheLocks
  cacheRoot(): string | undefined
  published(): void
  logger: Pick<MainLogger, 'debug' | 'info' | 'warn'>
  binaries?: { ffmpeg: string; ffprobe: string }
}

/** 精确导出的可靠画面同时交给节目合成和既有段发布器；后台补录停着也无需再执行页面。 */
export class WebCacheExportWriter {
  private readonly sessions = new Map<string, Promise<Session | undefined>>()
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
    const dropped = (): WebSourceCaptureResult => ({ dropped: true, boxes: null, duration: page.duration, contentHash: page.contentHash, pixelWidth: page.pixelWidth, pixelHeight: page.pixelHeight })
    try {
      let opening = this.sessions.get(page.streamId)
      if (!opening) { opening = this.open(page); this.sessions.set(page.streamId, opening) }
      const session = await waitWebCacheTask(opening, signal)
      // 没开成（来源已注销、实探未完成）不记住，下一幅再试。
      if (!session && this.sessions.get(page.streamId) === opening) this.sessions.delete(page.streamId)
      if (!session || session.closed || !session.registration.current || !await waitWebCacheTask(session.environment.current(), signal)) return signal.aborted ? dropped() : undefined
      const work = session.tail.then(async () => {
        signal.throwIfAborted()
        const abort = (): void => { session.segment?.controller.abort(signal.reason); session.segment?.feed.fail(signal.reason) }
        signal.addEventListener('abort', abort, { once: true })
        try { return await this.captureNow(session, request, signal) } finally { signal.removeEventListener('abort', abort) }
      })
      session.tail = work.then(() => undefined, () => undefined)
      const result = await waitWebCacheTask(work, signal)
      return signal.aborted ? dropped() : result
    } catch (error) { if (signal.aborted) return dropped(); throw error }
    finally { if (this.requests.get(key) === controller) this.requests.delete(key) }
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
    const session: Session = { page, registration, environment, reader, tail: Promise.resolve(), closed: false, stop: () => undefined }
    const stop = (): void => { this.close(page.streamId) }
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
      segment.controller.abort(new Error('精确导出网页时刻或取景不连续'))
      segment.feed.fail(segment.controller.signal.reason)
      await segment.done
      session.segment = segment = undefined
    }
    if (!segment) {
      // 不完整的段不能发布；等导出自然到达下一段首帧，不重演缺失部分。
      if (frame !== range.firstFrame || !this.options.cacheRoot()) return undefined
      segment = this.begin(session, key, range, { view, grid, deviceScaleFactor: view.scale, environmentSignature: environment.signature, chromium: process.versions.chrome }, selectors)
      session.segment = segment
      await Promise.race([segment.feed.started, segment.done])
    }
    signal.throwIfAborted()
    if (segment.finished || session.closed) return undefined
    const reliable = await page.captureReliable(webTimeAtFrame(grid, frame), request.ticket, session.reader, selectors, AbortSignal.any([signal, registration.signal]), { scale: request.scale })
    segment.next++
    // 画面已交付，缓存写入失败只结束本段，不能让导出重新执行网页或失败。
    try { await segment.feed.push(reliable) } catch { /* 发布器已记录具体失败原因。 */ }
    if (segment.next === range.firstFrame + range.frameCount) { await segment.done; session.segment = undefined }
    return { provenance: 'live', boxes: reliable.boxes, duration: page.duration, contentHash: page.contentHash, pixelWidth: size.width, pixelHeight: size.height }
  }

  private begin(session: Session, key: string, range: WebTimeSegment, variant: WebCacheVariant, selectors: string[]): Segment {
    const controller = new AbortController(), feed = new ExportFrames()
    const signal = AbortSignal.any([controller.signal, session.registration.signal])
    const segment: Segment = { key, range, next: range.firstFrame, selectors: [...selectors], feed, controller, finished: false, done: Promise.resolve() }
    const abort = (): void => feed.fail(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    segment.done = publishWebTimeSegment({ cacheRoot: this.options.cacheRoot()!, batch: session.registration.batch, variant, segment: range,
      ...codeWebPixelSize(variant.view), selectors, frames: () => feed.frames(range.frameCount),
      capability: this.options.capability, submissions: this.submissions, environmentCurrent: session.environment.current,
      signal, logger: this.options.logger, binaries: this.options.binaries,
      // 其他读者持有的段不阻塞精确导出，交给后台在空闲时补齐。
      withSegmentLock: (identity, work, active) => this.options.locks.withSegmentLock(identity, work, active, false),
    }).then(() => {
      this.options.published()
      this.options.logger.info('精确导出的网页画面已写入缓存', { event: 'web_source.export_cache.completed', context: { streamId: session.page.streamId, segment: range.index, frames: range.frameCount } })
    }).catch(error => {
      feed.fail(error)
      this.options.logger.debug('精确导出继续，网页缓存段未写入', { event: 'web_source.export_cache.skipped', context: { streamId: session.page.streamId, segment: range.index, reason: error instanceof Error ? error.message : String(error) } })
    }).finally(() => { segment.finished = true; signal.removeEventListener('abort', abort) })
    return segment
  }

  close(streamId: string): void {
    for (const [key, request] of this.requests) if (key.startsWith(`${streamId}\0`)) request.abort(new Error('精确导出网页来源已关闭'))
    const opening = this.sessions.get(streamId)
    this.sessions.delete(streamId)
    void opening?.then(async session => {
      if (!session || session.closed) return
      session.closed = true; session.stop()
      session.segment?.controller.abort(new Error('精确导出网页来源已关闭'))
      await session.tail; await session.segment?.done
      session.environment.close(); await session.reader.dispose()
    }).catch(error => this.options.logger.warn('精确导出网页缓存会话关闭失败', { event: 'web_source.export_cache.close_failed', error, context: { streamId } }))
  }
  cancel(streamId: string, ticket: string): boolean {
    const controller = this.requests.get(`${streamId}\0${ticket}`)
    controller?.abort(new Error('精确导出网页取帧已取消'))
    return !!controller
  }
  dispose(): void { this.disposed = true; for (const streamId of this.sessions.keys()) this.close(streamId) }
}
