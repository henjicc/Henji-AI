import path from 'node:path'
import fs from 'node:fs/promises'
import { codeWebPixelSize, type CodeWebView } from '../../../../src/core/videoEdit/codeMaterial/webSource'
import { webTimeFrameAt, webTimeSegment, type WebTimeGrid } from '../../../../src/core/videoEdit/webTimeCache'
import type { WebSourceCacheRequest } from '../../../../src/platform/contracts/videoFrameTypes'
import type { MainLogger } from '../logging/main-logger'
import type { WebCacheActivity } from './activity'
import type { WebCacheCapabilityGate } from './capability'
import type { WebCacheLocks } from './locks'
import type { WebSourcePage } from './page'
import { publishWebTimeSegment, webCacheVariantKey } from './publication'
import { WebCacheRecordingSlot, WebCacheOverlap, WebCacheOverlapMismatch, webCacheFrameEvidence } from './recording'
import type { WebCacheRegistration, WebCacheRegistrations } from './registration'
import { WebCacheSubmissions } from './submissions'

type Environment = NonNullable<Awaited<ReturnType<WebCacheRegistration['environment']>>>
interface Variant {
  key: string; source: WebSourcePage; registration: WebCacheRegistration; view: CodeWebView; grid: WebTimeGrid; preview: boolean
  signal: AbortSignal; controller: AbortController; detach(): void; environment?: Environment
  selectors: Set<string>; pending: Map<number, { distance: number; at: number }>; ready: Set<number>
  proofs: Map<number, { first: string; next?: string }>
  running: Set<number>; scan: number; scanEnabled: boolean; retryAt: number
}
interface SchedulerOptions {
  registrations: WebCacheRegistrations
  capability: WebCacheCapabilityGate
  activity: WebCacheActivity
  locks: WebCacheLocks
  cacheRoot(): string | undefined
  canScan(): Promise<boolean>
  published(): void
  /** 显存是否紧张（全系统占用使本机显存余量不足）；补录被前台抢占期间才查询。 */
  memoryTight?(signal: AbortSignal): Promise<{ tight: boolean; context?: Record<string, unknown> }>
  logger: Pick<MainLogger, 'info' | 'warn' | 'debug'>
  binaries?: { ffmpeg: string; ffprobe: string }
}

/** 抢占期间显存紧张：放弃本组保留的页面、读回器与编码会话，段从首帧向前重演，不算资源失败。 */
export class WebCacheMemoryRelease extends Error {
  constructor() { super('显存紧张，网页补录释放已保留的会话') }
}
const MEMORY_POLL_MS = 2_000
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** 单槽起步、成功后试增一个槽；资源失败逐级退槽，交叠差异只禁用该来源的并行录制。 */
export class WebCacheScheduler {
  private readonly variants = new Map<string, Variant>()
  private readonly submissions: WebCacheSubmissions
  private readonly lifetime = new AbortController()
  private flight?: Promise<void>
  private wake?: ReturnType<typeof setTimeout>
  private recordingRoot?: string
  private sequence = 0
  private slots = 1
  private growAfter = 0
  private readonly sequential = new WeakSet<WebCacheRegistration['batch']>()

  constructor(private readonly options: SchedulerOptions) { this.submissions = new WebCacheSubmissions(options.logger, options.activity) }

  demand(source: WebSourcePage, request: WebSourceCacheRequest): void {
    if (this.lifetime.signal.aborted || !request.cacheGrid || source.capturePath.captureMode !== 'html-in-canvas') return
    const registration = this.options.registrations.get(source.streamId)
    const frame = webTimeFrameAt(request.cacheGrid, request.time)
    if (!registration || frame === undefined) return
    const view = { ...source.view, region: [...source.view.region] as CodeWebView['region'], scale: request.scale ?? source.view.scale }
    const size = codeWebPixelSize(view)
    const preview = { ...view, scale: view.scale * Math.min(1, 2560 / size.width, 1440 / size.height) }
    const views = [{ view: preview, preview: true }, ...(!request.latest && preview.scale !== view.scale ? [{ view, preview: false }] : [])]
    const count = webTimeSegment(request.cacheGrid, 0, null)!.frameCount, index = Math.floor(frame / count)
    for (const specification of views) {
      const key = JSON.stringify([source.streamId, registration.batch.source.contentHash, specification.view, request.cacheGrid])
      let variant = this.variants.get(key)
      if (variant && variant.registration.batch !== registration.batch) { this.remove(variant); variant = undefined }
      if (!variant) {
        const controller = new AbortController()
        variant = { key, source, registration, ...specification, grid: request.cacheGrid,
          controller, signal: AbortSignal.any([registration.signal, controller.signal, this.lifetime.signal]), detach: () => undefined,
          selectors: new Set(), pending: new Map(), ready: new Set(), proofs: new Map(), running: new Set(), scan: 0, scanEnabled: true, retryAt: 0 }
        const held = variant
        const abort = (): void => this.remove(held)
        registration.signal.addEventListener('abort', abort, { once: true })
        variant.detach = () => registration.signal.removeEventListener('abort', abort)
        this.variants.set(key, variant)
      }
      for (const selector of request.boxes ?? []) if (!variant.selectors.has(selector)) { variant.selectors.add(selector); variant.ready.clear() }
      const indices = specification.preview ? [index, index + 1, index - 1] : [index]
      for (const at of indices) if (at >= 0 && !variant.running.has(at) && !variant.ready.has(at) && webTimeSegment(variant.grid, at, source.duration)) {
        variant.pending.set(at, { distance: Math.abs(at - index), at: ++this.sequence })
      }
    }
    this.start()
  }

  /** 容量回收后仅由新需求补回；不立刻扫录被刚刚淘汰的段。 */
  invalidated(): void { for (const variant of this.variants.values()) { variant.ready.clear(); variant.scanEnabled = false } }
  retry(source: WebSourcePage, request: WebSourceCacheRequest): void {
    const frame = webTimeFrameAt(request.cacheGrid, request.time)
    if (frame === undefined) return
    const index = Math.floor(frame / webTimeSegment(request.cacheGrid, 0, null)!.frameCount)
    for (const variant of this.variants.values()) if (variant.source === source && JSON.stringify(variant.grid) === JSON.stringify(request.cacheGrid)) variant.ready.delete(index)
    this.demand(source, request)
  }
  protects(file: string): boolean { return !!this.recordingRoot && path.resolve(file).startsWith(path.resolve(this.recordingRoot) + path.sep) }

  private remove(variant: Variant): void {
    if (this.variants.get(variant.key) === variant) this.variants.delete(variant.key)
    variant.controller.abort(new Error('网页补录来源已结束'))
    variant.detach(); variant.environment?.close(); variant.environment = undefined
    variant.pending.clear()
  }

  private start(): void {
    if (this.flight || this.lifetime.signal.aborted) return
    clearTimeout(this.wake); this.wake = undefined
    this.flight = this.pump().catch(error => this.options.logger.warn('网页补录调度失败，继续实时网页', { event: 'web_source.scheduler.failed', error }))
      .finally(() => {
        this.flight = undefined
        if (!this.lifetime.signal.aborted && [...this.variants.values()].some(variant => variant.pending.size || variant.scanEnabled && variant.preview && variant.source.duration !== null)) {
          this.wake = setTimeout(() => this.start(), 30_000)
        }
      })
  }

  private async pump(): Promise<void> {
    let retained: { variant: Variant; slot: WebCacheRecordingSlot } | undefined
    try {
      for (;;) {
        if (this.lifetime.signal.aborted) return
        for (const variant of this.variants.values()) if (!variant.registration.current) this.remove(variant)
        const candidates = [...this.variants.values()].filter(variant => variant.retryAt <= Date.now())
        let selected = candidates.flatMap(variant => [...variant.pending].map(([index, priority]) => ({ variant, index, ...priority })))
          .sort((a, b) => Number(b.variant.preview) - Number(a.variant.preview) || a.distance - b.distance || b.at - a.at)[0]
        if (!selected && candidates.some(variant => variant.preview && variant.scanEnabled && variant.source.duration !== null) && await this.options.canScan()) {
          for (const variant of candidates) {
            if (!variant.preview || !variant.scanEnabled || variant.source.duration === null) continue
            while (variant.ready.has(variant.scan) && webTimeSegment(variant.grid, variant.scan, variant.source.duration)) variant.scan++
            if (!webTimeSegment(variant.grid, variant.scan, variant.source.duration)) { variant.scanEnabled = false; continue }
            selected = { variant, index: variant.scan++, distance: 0, at: 0 }; break
          }
        }
        if (!selected) return
        if (this.sequential.has(selected.variant.registration.batch)) {
          const first = [...selected.variant.pending.keys()].sort((a, b) => a - b)[0]
          if (first !== undefined && first < selected.index) selected = { variant: selected.variant, index: first, ...selected.variant.pending.get(first)! }
        }
        const { variant, index } = selected
        const capacity = this.sequential.has(variant.registration.batch) ? 1 : this.slots
        const indices = [index]
        if (capacity > 1) {
          // 重演前一段作为交叠锚点；跨录制组边界也必须比较，不能只检验同组内的新段。
          if (index > 0) indices.unshift(index - 1)
          for (let next = index + 1; indices.length < capacity && webTimeSegment(variant.grid, next, variant.source.duration); next++) {
            if (!variant.pending.has(next) && !(variant.preview && variant.scanEnabled && variant.source.duration !== null && await this.options.canScan())) break
            indices.push(next)
          }
        }
        for (const at of indices) { variant.pending.delete(at); variant.running.add(at) }
        const selectorCount = variant.selectors.size
        try {
          if (retained && (indices.length > 1 || retained.variant !== variant || retained.slot.next > webTimeSegment(variant.grid, index, variant.source.duration)!.firstFrame)) {
            await retained.slot.close(); retained = undefined
          }
          if (indices.length === 1 && !retained) retained = { variant, slot: new WebCacheRecordingSlot(variant.source, variant.view, variant.grid, variant.registration.batch.source.contentHash, this.submissions, 0) }
          await this.record(variant, indices, retained?.slot)
          if (!variant.signal.aborted) {
            for (const at of indices) {
              if (selectorCount === variant.selectors.size) variant.ready.add(at)
              else variant.pending.set(at, { distance: selected.distance, at: ++this.sequence })
            }
            if (!this.sequential.has(variant.registration.batch) && Date.now() >= this.growAfter && indices.length === this.slots) this.slots++
          }
        } catch (error) {
          await retained?.slot.close(); retained = undefined
          if (variant.signal.aborted || !variant.registration.current) this.remove(variant)
          else if (error instanceof WebCacheMemoryRelease) {
            for (const at of indices) variant.pending.set(at, { distance: selected.distance, at: selected.at })
            // 前台结束前不再领取槽位，免得刚释放的会话又被重建。
            while (this.options.activity.active && !this.lifetime.signal.aborted) await sleep(250, this.lifetime.signal)
          }
          else if (error instanceof WebCacheOverlapMismatch) {
            this.sequential.add(variant.registration.batch)
            for (const affected of this.variants.values()) if (affected.registration.batch === variant.registration.batch) {
              for (const at of new Set([...affected.ready, ...affected.proofs.keys()])) affected.pending.set(at, { distance: 0, at: ++this.sequence })
              affected.ready.clear(); affected.proofs.clear()
            }
            for (const at of indices) variant.pending.set(at, { distance: selected.distance, at: ++this.sequence })
            this.options.logger.warn('相邻槽交叠不同，该网页退回单槽顺序录制', { event: 'web_source.scheduler.overlap_failed', error, context: { streamId: variant.source.streamId, frame: error.frame, slots: indices.length } })
          }
          else {
            this.slots = Math.max(1, this.slots - 1); this.growAfter = Date.now() + 30_000
            variant.retryAt = Date.now() + 30_000
            for (const at of indices) variant.pending.set(at, { distance: selected.distance, at: selected.at })
            this.options.logger.warn('网页补录暂时退槽，稍后从段首向前重演', { event: 'web_source.scheduler.throttled', error, context: { streamId: variant.source.streamId, segment: index, retryAt: variant.retryAt, activeSlots: 0, capacity: this.slots } })
          }
        } finally { variant.running.clear() }
      }
    } finally { await retained?.slot.close() }
  }

  private async record(variant: Variant, indices: number[], retained?: WebCacheRecordingSlot): Promise<void> {
    const { options, submissions } = this
    const cacheRoot = options.cacheRoot()
    if (!cacheRoot) throw new Error('作品缓存目录不可用')
    variant.signal.throwIfAborted()
    const capability = await options.capability.check({ submissions, signal: variant.signal })
    if (!capability.available) throw new Error(`网页缓存硬件链路暂不可用：${capability.reason}`)
    variant.environment ??= await variant.registration.environment()
    const environment = variant.environment
    if (variant.signal.aborted) { environment?.close(); variant.environment = undefined; variant.signal.throwIfAborted() }
    if (!environment || !await environment.current()) { this.remove(variant); throw new Error('网页补录环境不可缓存') }
    const size = codeWebPixelSize(variant.view), source = variant.source
    const identity = { view: variant.view, deviceScaleFactor: variant.view.scale, grid: variant.grid, environmentSignature: environment.signature, chromium: process.versions.chrome }
    await fs.mkdir(cacheRoot, { recursive: true })
    const root = await fs.realpath(cacheRoot)
    this.recordingRoot = cacheRoot
    try {
      // 所有实例先拿变体组锁，再取单段锁，避免不同槽各占一段、在交叠屏障互等。
      await options.locks.withSegmentLock(`${root}:${webCacheVariantKey(variant.registration.batch.source.contentHash, identity)}:recording`, async lease => {
        const controller = new AbortController(), released = new AbortController(), signal = AbortSignal.any([lease.signal, controller.signal, released.signal])
        const watching = this.watchMemory(source, released, signal)
        const sequential = this.sequential.has(variant.registration.batch)
        const overlap = indices.length > 1 ? new WebCacheOverlap(indices, index => webTimeSegment(variant.grid, index, source.duration)!.firstFrame, signal) : undefined
        const slots: WebCacheRecordingSlot[] = []
        let failure: unknown
        try {
          const results = await Promise.allSettled(indices.map(async index => {
            const segment = webTimeSegment(variant.grid, index, source.duration)!
            const slot = retained ?? new WebCacheRecordingSlot(source, variant.view, variant.grid, variant.registration.batch.source.contentHash, submissions, segment.firstFrame)
            if (!retained) slots.push(slot)
            let first: Awaited<ReturnType<typeof webCacheFrameEvidence>> | undefined
            let proof: { first: string; next?: string } | undefined
            const frames = (frameSignal: AbortSignal, selectors: readonly string[]) => (async function* () {
              for (let offset = 0; offset < segment.frameCount; offset++) {
                const captured = await slot.capture(segment.firstFrame + offset, selectors, frameSignal)
                if (offset === 0 && !sequential) first = await webCacheFrameEvidence(captured)
                yield captured
              }
            })()
            options.logger.info('网页补录领取录制槽', { event: 'web_source.scheduler.start', context: { streamId: source.streamId, segment: index, preview: variant.preview, ...size, slots: indices.length, queued: variant.pending.size } })
            try {
              await publishWebTimeSegment({ cacheRoot: root, batch: variant.registration.batch, variant: identity,
                segment, ...size, capability: options.capability, submissions, signal, environmentCurrent: environment.current,
                selectors: [...variant.selectors], frames, logger: options.logger, binaries: options.binaries,
                beforePublish: async () => {
                  if (sequential) return
                  const hasNext = !!webTimeSegment(variant.grid, index + 1, source.duration)
                  const next = hasNext ? await webCacheFrameEvidence(await slot.capture(segment.firstFrame + segment.frameCount, [], signal)) : undefined
                  proof = { first: first!.fingerprint, next: next?.fingerprint }
                  const prior = variant.proofs.get(index), left = variant.proofs.get(index - 1), right = variant.proofs.get(index + 1)
                  if (prior && (prior.first !== proof.first || prior.next !== proof.next) || left && left.next !== proof.first || right && proof.next !== right.first) throw new WebCacheOverlapMismatch(segment.firstFrame)
                  const check = async (): Promise<boolean> => !!first?.isCurrent() && await first.validate() && (!next || next.isCurrent() && await next.validate())
                  if (overlap) await overlap.arrive(index, { ...proof, check })
                  else if (!await check()) throw new Error('网页交叠快照发布资格已失效')
                },
                withSegmentLock: (key, work, active) => options.locks.withSegmentLock(key, work, active) })
              options.published()
              if (proof) variant.proofs.set(index, proof)
              options.logger.info('网页补录段完成', { event: 'web_source.scheduler.completed', context: { streamId: source.streamId, segment: index, frames: segment.frameCount, slots: indices.length } })
            } catch (error) { failure ??= error; controller.abort(error); throw error }
          }))
          if (results.some(result => result.status === 'rejected')) throw released.signal.aborted ? released.signal.reason : failure
          if (overlap) options.logger.info('网页相邻槽交叠校验通过', { event: 'web_source.scheduler.overlap_completed', context: { streamId: source.streamId, segments: indices, slots: indices.length } })
        } finally { controller.abort(); await watching; overlap?.close(); await Promise.all(slots.map(slot => slot.close())) }
      }, variant.signal)
    } finally { this.recordingRoot = undefined }
  }

  /** 组在途且被前台抢占时定期查显存；紧张就中止本组，由组的清理关闭页面、读回器与编码器并删除临时文件。 */
  private async watchMemory(source: WebSourcePage, released: AbortController, signal: AbortSignal): Promise<void> {
    const { memoryTight, activity, logger } = this.options
    if (!memoryTight) return
    while (!signal.aborted) {
      await sleep(MEMORY_POLL_MS, signal)
      if (signal.aborted || !activity.active) continue
      const pressure = await memoryTight(signal).catch(() => ({ tight: false, context: undefined }))
      if (!pressure.tight || signal.aborted) continue
      logger.info('显存紧张，网页补录释放保留的会话', { event: 'web_source.record.released', context: { streamId: source.streamId, ...pressure.context } })
      released.abort(new WebCacheMemoryRelease())
      return
    }
  }

  async drained(): Promise<void> { await this.flight }
  dispose(): void {
    this.lifetime.abort(new Error('网页补录调度已结束')); clearTimeout(this.wake)
    for (const variant of this.variants.values()) this.remove(variant)
  }
}
