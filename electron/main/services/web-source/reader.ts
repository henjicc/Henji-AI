import path from 'node:path'
import { codeWebPixelSize, type CodeWebView } from '../../../../src/core/videoEdit/codeMaterial/webSource'
import { webTimeFrameAt, webTimeSegment } from '../../../../src/core/videoEdit/webTimeCache'
import type { WebSourceCacheRequest, WebSourceCaptureRequest, WebSourceCaptureResult } from '../../../../src/platform/contracts/videoFrameTypes'
import type { MainLogger } from '../logging/main-logger'
import type { VideoDecoderService } from '../video-decoder/client'
import { VideoDecoderError } from '../video-decoder/protocol'
import type { VideoFrameBridge } from '../video-decoder/texture-bridge'
import type { WebCacheCapabilityGate } from './capability'
import type { WebSourcePage } from './page'
import { readWebTimeGeometry, readWebTimeSegment, webCacheVariantKey } from './publication'
import type { WebCacheRegistration, WebCacheRegistrations } from './registration'
import type { WebCacheSegments, WebCacheSegmentHold } from './segments'

type Environment = NonNullable<Awaited<ReturnType<WebCacheRegistration['environment']>>>
interface Source { registration: WebCacheRegistration; environment?: Environment; preparing: boolean; retryAt: number; detach(): void }
type Published = { segment: NonNullable<Awaited<ReturnType<typeof readWebTimeSegment>>>; geometry: NonNullable<Awaited<ReturnType<typeof readWebTimeGeometry>>> }
/**
 * 持有段锁期间段文件不会被替换或回收，清单与几何只在取得锁后读一次，最近使用时间也只刷新一次；
 * 逐帧读盘在 Windows 上每次打开都要几毫秒，会让缓存读取慢过实时网页。
 */
type HeldSegment = WebCacheSegmentHold & { index: number; published?: Published; touched?: boolean }
interface Decoder { tail: Promise<void>; streamId?: string; file?: string; videoHash?: string; segment?: HeldSegment; closed: boolean; idle?: ReturnType<typeof setTimeout> }
interface Options {
  registrations: WebCacheRegistrations
  capability: WebCacheCapabilityGate
  segments: WebCacheSegments
  service: VideoDecoderService
  bridge: VideoFrameBridge
  logger: Pick<MainLogger, 'debug' | 'warn'>
  retry(page: WebSourcePage, request: WebSourceCacheRequest): void
}

/** 同变体所有窗口与段串行共用一个解码器；来源信任与帧交付仍逐次核对。 */
export class WebCacheReader {
  private readonly sources = new Map<string, Source>()
  private readonly decoders = new Map<string, Decoder>()
  private readonly requests = new Map<string, AbortController>()
  private readonly failures = new Map<string, string>()
  private disposed = false
  private nextTicket = 0
  private readonly unsubscribe: () => void

  constructor(private readonly options: Options) {
    this.unsubscribe = options.service.onLifecycle(event => {
      if (event.type === 'exited') for (const [key, decoder] of this.decoders) void this.closeDecoder(key, decoder)
    })
  }

  /** 字体/存储签名在需求到达时准备；首帧不等待后台环境扫描。 */
  prepare(page: WebSourcePage): void {
    const registration = this.options.registrations.get(page.streamId)
    const previous = this.sources.get(page.streamId)
    if (previous && previous.registration.batch === registration?.batch
      && (previous.preparing || previous.environment?.isCurrent() || performance.now() < previous.retryAt)) return
    this.close(page.streamId)
    if (!registration || this.disposed) return
    const abort = (): void => this.close(page.streamId)
    const source: Source = { registration, preparing: true, retryAt: 0, detach: () => registration.signal.removeEventListener('abort', abort) }
    registration.signal.addEventListener('abort', abort, { once: true })
    this.sources.set(page.streamId, source)
    void registration.environment().then(environment => {
      if (this.sources.get(page.streamId) !== source || !registration.current) environment?.close()
      else source.environment = environment
    }).catch(error => this.options.logger.warn('网页缓存读取环境未就绪，继续实时网页', { event: 'web_source.cache.environment_failed', error, context: { streamId: page.streamId } }))
      .finally(() => { source.preparing = false; if (!source.environment) source.retryAt = performance.now() + 1000 })
  }

  async capture(page: WebSourcePage, request: WebSourceCaptureRequest): Promise<WebSourceCaptureResult | undefined> {
    if (request.precision !== 'web-cache' || !request.cacheGrid || this.disposed) return undefined
    this.prepare(page)
    const source = this.sources.get(page.streamId), generation = this.options.capability.availableGeneration
    if (!source?.environment || generation === undefined) return this.miss(page, 'not-ready')
    const { registration, environment } = source
    const grid = request.cacheGrid, frame = webTimeFrameAt(grid, request.time)
    if (frame === undefined) return this.miss(page, 'off-grid')
    const controller = new AbortController(), requestKey = `${page.streamId}\0${request.ticket}`
    if (request.latest) for (const [key, previous] of this.requests) if (key.startsWith(`${page.streamId}\0`)) previous.abort()
    this.requests.set(requestKey, controller)
    const signal = AbortSignal.any([controller.signal, registration.signal, page.signal])
    const current = (): boolean => !signal.aborted && registration.current && environment.isCurrent() && this.options.capability.isCurrent(generation)
    const view: CodeWebView = { ...page.view, scale: request.scale ?? page.view.scale }
    const size = codeWebPixelSize(view)
    if (request.latest) view.scale *= Math.min(1, 2560 / size.width, 1440 / size.height)
    const expected = codeWebPixelSize(view)
    const variantKey = webCacheVariantKey(registration.batch.source.contentHash, { view, grid, deviceScaleFactor: view.scale, environmentSignature: environment.signature, chromium: process.versions.chrome })
    const index = Math.floor(frame / webTimeSegment(grid, 0, null)!.frameCount)
    const key = variantKey
    let decoder = this.decoders.get(key)
    if (!decoder || decoder.closed) {
      const held: Decoder = { tail: Promise.resolve(), closed: false }
      this.decoders.set(key, held); decoder = held
    }
    const held = decoder
    clearTimeout(held.idle)
    const work = held.tail.then(async (): Promise<WebSourceCaptureResult | undefined> => {
      if (held.closed || !current() || !await environment.current() || !current()) return this.miss(page, 'environment-changed')
      const started = performance.now()
      const segmentHold: HeldSegment | undefined = held.segment?.index === index ? held.segment
        : await this.options.segments.hold(variantKey, index).then(hold => hold && { ...hold, index })
      if (!segmentHold) return this.miss(page, 'segment-busy')
      const { root, lease } = segmentHold
      const read = async (): Promise<WebSourceCaptureResult | undefined> => {
        if (!current()) return undefined
        if (!segmentHold.published) {
          const segment = await readWebTimeSegment(root, variantKey, index)
          const geometry = segment && await readWebTimeGeometry(segment)
          if (segment && geometry) segmentHold.published = { segment, geometry }
        }
        const { segment, geometry } = segmentHold.published ?? {}
        const offset = segment ? frame - segment.manifest.segment.firstFrame : -1
        const boxes = geometry?.boxes[offset]
        if (!segment || !geometry || offset < 0 || offset >= segment.manifest.segment.frameCount
          || segment.manifest.contentHash !== registration.batch.source.contentHash || segment.manifest.width !== expected.width || segment.manifest.height !== expected.height
          || (request.boxes ?? []).some(selector => !boxes || !Object.hasOwn(boxes, selector))) {
          if (held.streamId && held.file === path.join(root, `${variantKey}-${index}`, 'video.mp4')) {
            await this.options.bridge.closeStream(held.streamId)
            held.streamId = undefined; held.file = undefined; held.videoHash = undefined
          }
          this.options.retry(page, { ...request, cacheGrid: grid })
          return this.miss(page, 'missing-segment-or-geometry')
        }
        const file = path.join(segment.directory, 'video.mp4')
        let invalid = false
        let changingSegment = false
        try {
          if (!held.streamId) {
            const info = await this.options.bridge.openSharedDecoder({ route: 'web-cache', path: file, purpose: 'seek', hardware: 'auto', format: 'rgbaf16', poolSize: 2 })
            held.streamId = info.streamId; held.file = file; held.videoHash = segment.manifest.video.sha256
            if (!info.decoder.hardware || info.decoder.path !== 'cuda_planar') throw new Error('网页缓存硬解链路暂不可用')
            if (info.visibleRect.width !== segment.manifest.codedWidth || info.visibleRect.height !== segment.manifest.codedHeight) { invalid = true; throw new Error('网页缓存尺寸不匹配') }
          } else if (held.file !== file || held.videoHash !== segment.manifest.video.sha256) {
            // 切段改变共享状态，必须等到确定结果；调用方取消只丢弃随后交付。
            changingSegment = true
            await this.options.service.setDecoderSegment(held.streamId, file)
            held.file = file; held.videoHash = segment.manifest.video.sha256
            changingSegment = false
          }
          if (held.closed || !current()) return undefined
          if (!segmentHold.touched) { segmentHold.touched = true; await this.options.segments.touch(segment.directory) }
          const localTime = offset * grid.rate.denominator / grid.rate.numerator
          const nativeStream = held.streamId
          const ticket = `web-cache-${++this.nextTicket}`
          const abort = (): void => { this.options.bridge.cancelFrameAt(page.target.id, nativeStream, ticket) }
          signal.addEventListener('abort', abort, { once: true })
          try {
            const result = await this.options.bridge.frameAt(page.target.id, { streamId: nativeStream, ticket, time: localTime }, {
              target: page.target, ticket: request.ticket,
              streamId: page.streamId, route: page.route, timestampUs: Math.round(request.time * 1e6), ...expected,
              accept: ptsUs => {
                if (held.closed || !current() || lease.signal.aborted) return false
                if (ptsUs === undefined || Math.abs(ptsUs - localTime * 1e6) >= 2) { invalid = true; return false }
                return true
              },
            })
            if (!current()) return undefined
            if (!result.found || result.approximate) { invalid = true; throw new Error('网页缓存帧缺失') }
          } finally { signal.removeEventListener('abort', abort) }
          this.failures.delete(page.streamId)
          this.options.logger.debug('网页缓存命中', { event: 'web_source.cache.hit', context: { streamId: page.streamId, ticket: request.ticket, targetId: page.target.id, variantKey, segment: index, frame, elapsedMs: performance.now() - started } })
          return { provenance: 'web-cache', boxes: request.boxes ? Object.fromEntries(request.boxes.map(selector => [selector, boxes![selector]])) : null,
            duration: page.duration, contentHash: page.contentHash, pixelWidth: expected.width, pixelHeight: expected.height }
        } catch (error) {
          if (signal.aborted && !invalid && !changingSegment) return undefined
          if (held.streamId) await this.options.bridge.closeStream(held.streamId)
          held.streamId = undefined; held.file = undefined; held.videoHash = undefined
          invalid ||= error instanceof VideoDecoderError && ['DECODE_FAILED', 'FORMAT_CHANGED', 'UNSUPPORTED_FORMAT'].includes(error.code)
          if (invalid && current() && !lease.signal.aborted) {
            await lease.discard(segment.directory)
            this.options.retry(page, { ...request, cacheGrid: grid })
          }
          this.options.logger.warn('网页缓存解码失败，使用实时页面', { event: 'web_source.cache.decode_failed', error, context: { streamId: page.streamId, variantKey, segment: index } })
          return this.miss(page, 'decode-failed')
        }
      }
      try { return await read() }
      finally {
        const file = path.join(root, `${variantKey}-${index}`, 'video.mp4')
        if (held.streamId && held.file === file && !lease.signal.aborted) {
          if (held.segment !== segmentHold) {
            const previous = held.segment
            held.segment = segmentHold
            await previous?.release()
          }
        } else {
          await segmentHold.release()
          if (!held.streamId) { if (held.segment !== segmentHold) await held.segment?.release(); held.segment = undefined }
        }
      }
    })
    const tail = work.then(() => undefined, () => undefined)
    held.tail = tail
    const dropped = (): WebSourceCaptureResult => ({ dropped: true, boxes: null, duration: page.duration, contentHash: page.contentHash, pixelWidth: expected.width, pixelHeight: expected.height })
    try { const result = await work; return signal.aborted ? dropped() : result }
    catch (error) {
      if (!signal.aborted) this.options.logger.warn('网页缓存读取失败，使用实时页面', { event: 'web_source.cache.read_failed', error, context: { streamId: page.streamId, variantKey, segment: index } })
      return signal.aborted ? dropped() : this.miss(page, 'read-failed')
    } finally {
      if (this.requests.get(requestKey) === controller) this.requests.delete(requestKey)
      if (!held.closed && held.tail === tail) { clearTimeout(held.idle); held.idle = setTimeout(() => { void this.closeDecoder(key, held) }, 3000) }
    }
  }

  private miss(page: WebSourcePage, reason: string): undefined {
    if (this.failures.get(page.streamId) !== reason) {
      this.failures.set(page.streamId, reason)
      this.options.logger.debug('网页缓存未命中，使用实时页面', { event: 'web_source.cache.miss', context: { streamId: page.streamId, reason } })
    }
    return undefined
  }
  cancel(streamId: string, ticket: string): boolean { const request = this.requests.get(`${streamId}\0${ticket}`); request?.abort(); return !!request }
  close(streamId: string): void {
    const source = this.sources.get(streamId)
    source?.detach(); source?.environment?.close(); this.sources.delete(streamId); this.failures.delete(streamId)
    for (const [key, controller] of this.requests) if (key.startsWith(`${streamId}\0`)) controller.abort()
  }
  private async closeDecoder(key: string, decoder: Decoder): Promise<void> {
    if (decoder.closed) return
    decoder.closed = true; clearTimeout(decoder.idle)
    if (this.decoders.get(key) === decoder) this.decoders.delete(key)
    await decoder.tail
    if (decoder.streamId) await this.options.bridge.closeStream(decoder.streamId)
    await decoder.segment?.release()
  }
  dispose(): void {
    this.disposed = true; this.unsubscribe()
    for (const streamId of this.sources.keys()) this.close(streamId)
    for (const [key, decoder] of this.decoders) void this.closeDecoder(key, decoder)
  }
}
