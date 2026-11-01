import { codeWebBoxesIssue, codeWebFolderOf, codeWebView } from '../../../../src/core/videoEdit/codeMaterial/webSource'
import type { WebSourceCacheRequest, WebSourceCaptureRequest, WebSourceCaptureResult, WebSourceContentChange, WebSourceInfo, WebSourceOpenRequest } from '../../../../src/platform/contracts/videoFrameTypes'
import type { MainLogger } from '../logging/main-logger'
import type { VideoFrameTarget } from '../video-decoder'
import { WebSourceContent } from './content'
import { WebSourcePage } from './page'
import { resolveWebSourceFolder } from './site'
import { contentTrustQuerySchema } from '../../../../src/core/contentTrust'
import type { WebCacheRegistrations } from './registration'
import { webTimeGridFromFraction } from '../../../../src/core/videoEdit/webTimeCache'
import type { WebCacheReader } from './reader'
import { WebCacheReadTiming } from './readTiming'
import type { WebCacheExportWriter } from './exportWriter'
import { webTextSelectors } from '../../../../src/core/videoEdit/webTextGeometry'

const ROUTE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/

function record(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label}必须是对象`)
  return input as Record<string, unknown>
}

function sourcePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0') || !/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value)) throw new Error('网页来源 path 需要本机绝对路径')
  return value
}

export function parseWebSourceOpenRequest(input: unknown): WebSourceOpenRequest {
  const fields = record(input, '网页来源请求')
  if (typeof fields.route !== 'string' || !ROUTE_PATTERN.test(fields.route)) throw new Error('网页来源参数 route 无效')
  if (['width', 'height', 'region', 'scale'].some(key => fields[key] === undefined)) throw new Error('网页来源需要 width、height、region 与 scale')
  const view = codeWebView({ width: fields.width as number, height: fields.height as number, region: fields.region as number[], scale: fields.scale as number }, 'output')
  const trust = fields.trust === undefined ? undefined : contentTrustQuerySchema.parse({ contents: fields.trust }).contents
  return { route: fields.route, path: sourcePath(fields.path), ...view, ...(trust ? { trust } : {}) }
}

export function parseWebSourceCaptureRequest(input: unknown): WebSourceCaptureRequest {
  const fields = record(input, '网页取帧请求')
  for (const key of ['streamId', 'ticket'] as const) if (typeof fields[key] !== 'string' || !ID_PATTERN.test(fields[key] as string)) throw new Error(`网页取帧参数 ${key} 无效`)
  if (typeof fields.time !== 'number' || !Number.isFinite(fields.time) || fields.time < 0) throw new Error('网页取帧参数 time 需要非负秒数')
  if (fields.boxes !== undefined) { const issue = codeWebBoxesIssue(fields.boxes); if (issue) throw new Error(issue) }
  if (fields.scale !== undefined && (typeof fields.scale !== 'number' || !Number.isFinite(fields.scale) || fields.scale <= 0 || fields.scale > 8192)) throw new Error('网页取帧倍率需要大于 0 且不超过 8192')
  if (fields.latest !== undefined && typeof fields.latest !== 'boolean') throw new Error('网页取帧 latest 需要布尔值')
  if (fields.precision !== undefined && fields.precision !== 'exact' && fields.precision !== 'web-cache') throw new Error('网页取帧精度无效')
  if (fields.cachePolicy !== undefined && fields.cachePolicy !== 'adaptive') throw new Error('网页缓存读取策略无效')
  if (fields.cacheWrite !== undefined && typeof fields.cacheWrite !== 'boolean') throw new Error('网页缓存写入标记无效')
  const text = fields.text === undefined ? undefined : webTextSelectors(fields.text)
  return { streamId: fields.streamId as string, ticket: fields.ticket as string, time: fields.time, ...(fields.boxes ? { boxes: fields.boxes as string[] } : {}), ...(text?.length ? { text } : {}), ...(fields.scale !== undefined ? { scale: fields.scale as number } : {}), ...(fields.latest !== undefined ? { latest: fields.latest as boolean } : {}),
    ...(fields.precision !== undefined ? { precision: fields.precision } : {}), ...(fields.cacheWrite !== undefined ? { cacheWrite: fields.cacheWrite } : {}), ...(fields.cachePolicy !== undefined ? { cachePolicy: fields.cachePolicy } : {}), ...(fields.cacheGrid !== undefined ? { cacheGrid: parseCacheGrid(fields.cacheGrid) } : {}) }
}

export function parseWebSourceCacheRequest(input: unknown): WebSourceCacheRequest {
  const fields = record(input, '网页补录需求')
  const { ticket: _ticket, ...capture } = parseWebSourceCaptureRequest({ ...fields, ticket: 'cache' })
  if (!capture.cacheGrid) throw new Error('网页补录需要采样网格')
  return { ...capture, cacheGrid: capture.cacheGrid }
}

function parseCacheGrid(input: unknown): WebSourceCacheRequest['cacheGrid'] {
  const grid = record(input, '网页采样网格'), rate = record(grid.rate, '网页采样帧率'), phase = record(grid.phase, '网页采样相位')
  if (typeof rate.numerator !== 'number' || typeof rate.denominator !== 'number' || typeof phase.numerator !== 'string' || !/^\d+$/.test(phase.numerator)
    || typeof phase.denominator !== 'string' || !/^[1-9]\d*$/.test(phase.denominator)) throw new Error('网页采样网格无效')
  return webTimeGridFromFraction({ numerator: rate.numerator, denominator: rate.denominator }, { numerator: BigInt(phase.numerator), denominator: BigInt(phase.denominator) })
}

/**
 * 要监视的网页路径清单，不限条数（打开着的剪辑引用多少就监视多少）。不是本机绝对路径的条目逐条跳过：
 * 剪辑里一条写坏的引用不能让同一窗口里其他网页文件夹都失去监视。
 */
export function parseWebSourcePaths(input: unknown): string[] {
  const paths = record(input, '网页监视请求').paths
  if (!Array.isArray(paths)) throw new Error('网页监视请求 paths 需要路径数组')
  return paths.flatMap(path => { try { return [sourcePath(path)] } catch { return [] } })
}

/**
 * 网页来源的离屏页面：每个页面归属打开它的窗口与帧通道（通道断开、窗口导航或关闭时一并关掉），取帧只能操作本窗口的页面。
 * 渲染层按来源、取景与取样轨道复用页面；不同轨道可以停在不同的页面时刻。
 */
export class WebSourcePages {
  private readonly pages = new Map<string, WebSourcePage>()
  private readonly pageTrust = new Map<string, WebSourceOpenRequest['trust']>()
  private readonly watchedTargets = new Map<number, () => void>()
  /** 每个页面上一次记下的失败原因：页面坏掉时每帧都会失败，同一原因只记一次，恢复或原因变了再记。 */
  private readonly lastFailure = new Map<string, string>()
  /** 每个网页路径上一次打开失败的原因：打不开时渲染层每帧重试，同一原因只记一次，打开成功或原因变了再记。 */
  private readonly lastOpenFailure = new Map<string, string>()
  /** 已记过“页面没停住”的页面。 */
  private readonly unsettled = new Set<string>()
  /** 每个窗口要监视的网页文件夹（它打开着的剪辑引用的）：文件夹 → 引用它的路径。 */
  private readonly interests = new Map<number, Map<string, string[]>>()
  private nextId = 1
  private readonly content: WebSourceContent
  private readonly cacheDemands = new Map<string, WebSourceCacheRequest>()
  private readonly readTiming = new WebCacheReadTiming()

  constructor(private readonly logger: Pick<MainLogger, 'debug' | 'info' | 'warn'>, broadcast: (change: WebSourceContentChange) => void, readonly registrations?: WebCacheRegistrations,
    private readonly cache?: { demand(page: WebSourcePage, request: WebSourceCacheRequest): void; dispose(): void }, private readonly reader?: WebCacheReader, private readonly exportWriter?: WebCacheExportWriter) {
    this.content = new WebSourceContent((root, contentHash, paths) => {
      for (const page of this.pages.values()) if (page.folder.root === root) {
        this.registrations?.remove(page.streamId)
        void page.reload(contentHash).then(
          async () => {
            this.logger.info('网页来源已按新内容重新载入', { event: 'web_source.page.reloaded', context: { streamId: page.streamId, contentHash, ...page.capturePath } })
            await this.register(page)
          },
          error => this.failed(page, 'web_source.page.reload_failed', '网页来源重新载入失败', error),
        )
      }
      for (const path of paths) broadcast({ path, contentHash })
    }, logger)
  }

  /**
   * 设定这个窗口要监视的网页路径（它打开着的剪辑引用的全部网页，整份替换），返回各路径当前的内容指纹（读不出来为 null）。
   * 有页面开着与否都监视，文件夹改动经 `WEB_SOURCE_CONTENT_CHANGED_CHANNEL` 按路径通知；窗口关闭或导航时一并释放。
   */
  async watchContent(target: VideoFrameTarget, paths: readonly string[]): Promise<Record<string, string | null>> {
    // 窗口已经关掉：不再登记，否则关闭回调已经错过，监视永远不会释放
    if (target.isDestroyed()) return {}
    const next = new Map<string, string[]>()
    for (const path of paths) {
      const root = codeWebFolderOf(path)
      if (root) next.set(root, [...next.get(root) ?? [], path])
    }
    const previous = this.interests.get(target.id) ?? new Map<string, string[]>()
    for (const [root, rootPaths] of next) {
      if (!previous.has(root)) this.content.hold(root)
      this.content.request(root, rootPaths)
    }
    for (const root of previous.keys()) if (!next.has(root)) this.content.release(root)
    if (next.size) { this.interests.set(target.id, next); this.watchTarget(target) } else this.interests.delete(target.id)
    const entries = await Promise.all(paths.map(async path => {
      const root = codeWebFolderOf(path)
      return [path, root ? await this.content.current(root).catch(() => null) : null] as const
    }))
    return Object.fromEntries(entries)
  }

  async open(target: VideoFrameTarget, request: WebSourceOpenRequest): Promise<WebSourceInfo> {
    if (target.isDestroyed()) throw new Error('目标窗口已关闭')
    const startedAt = Date.now()
    const streamId = `web-${this.nextId++}`
    const { route, path, trust, ...view } = request
    const context = { streamId, targetId: target.id, route, path, width: view.width, height: view.height, region: view.region, scale: view.scale }
    const retrying = this.lastOpenFailure.has(path)
    if (!retrying) this.logger.info('打开网页来源', { event: 'web_source.page.open.start', context })
    let page: WebSourcePage | undefined
    let retained: string | undefined
    try {
      const folder = await resolveWebSourceFolder(path)
      this.content.hold(folder.root)
      retained = folder.root
      const contentHash = await this.content.current(folder.root)
      page = new WebSourcePage(streamId, target, route, folder, view, contentHash,
        reason => this.logger.warn('网页来源页面进程退出，下一次取帧时重新载入', { event: 'web_source.page.gone', context: { streamId, reason } }),
        reason => this.logger.warn('网页快照取帧不可用，使用普通页面绘制', { event: 'web_source.capture.fallback', context: { streamId, captureMode: 'compositor', reason } }),
      )
      this.pages.set(streamId, page)
      this.pageTrust.set(streamId, trust)
      this.watchTarget(target)
      await page.open()
      await this.register(page)
    } catch (error) {
      this.pages.delete(streamId)
      this.pageTrust.delete(streamId)
      this.registrations?.remove(streamId)
      page?.close()
      if (retained) this.content.release(retained)
      const reason = error instanceof Error ? error.message : String(error)
      if (this.lastOpenFailure.get(path) !== reason) {
        this.lastOpenFailure.set(path, reason)
        this.logger.warn('网页来源打开失败', { event: 'web_source.page.open.failed', error, context })
      }
      throw error
    }
    this.lastOpenFailure.delete(path)
    this.logger.info('网页来源已打开', { event: 'web_source.page.open.completed', context: { ...context, elapsedMs: Date.now() - startedAt, pixelWidth: page.pixelWidth, pixelHeight: page.pixelHeight, duration: page.duration, contentHash: page.contentHash, ...page.capturePath } })
    return { streamId, route, contentHash: page.contentHash, duration: page.duration, pixelWidth: page.pixelWidth, pixelHeight: page.pixelHeight }
  }

  async capture(targetId: number, request: WebSourceCaptureRequest): Promise<WebSourceCaptureResult> {
    const page = this.pages.get(request.streamId)
    if (!page || page.target.id !== targetId) throw new Error('网页来源不存在或不属于当前窗口')
    const startedAt = performance.now()
    if (request.text?.length) this.logger.debug('采样网页文本几何', { event: 'web_source.text_geometry.start', context: { streamId: page.streamId, ticket: request.ticket, time: request.time, selectors: request.text.length } })
    const selection = request.precision === 'web-cache' && request.cachePolicy === 'adaptive' ? this.readTiming.select(page.contentHash, request) : undefined
    try {
      if (selection?.changed) this.logger.debug('网页画面按实测耗时选择来源', { event: 'web_source.cache.selection', context: { streamId: page.streamId, reason: selection.reason, liveMs: selection.liveMs, cacheMs: selection.cacheMs } })
      // 缓存帧不带文字几何：要文字位置的请求只走实时取帧。
      const cached = request.text?.length || selection && !selection.cache ? undefined : await this.reader?.capture(page, request)
      if (cached) {
        if (selection && !cached.dropped) this.readTiming.record(selection.key, true, performance.now() - startedAt, selection.warmup)
        return cached
      }
      try {
        const written = request.text?.length ? undefined : await this.exportWriter?.capture(page, request)
        if (written) return written
      } catch (error) {
        this.logger.warn('网页精确导出缓存不可用，继续实时取帧', { event: 'web_source.export_cache.failed', error, context: { streamId: page.streamId, time: request.time } })
      }
      const liveStarted = performance.now()
      const { boxes, text, duration, unsettled, dropped, pixelWidth, pixelHeight } = await page.capture(request.time, request.ticket, request.boxes, request)
      if (dropped) {
        this.logger.debug('过时网页取帧已丢弃', { event: 'web_source.capture.dropped', context: { streamId: page.streamId, ticket: request.ticket, time: request.time } })
        return { boxes, duration, contentHash: page.contentHash, dropped, pixelWidth, pixelHeight }
      }
      if (selection) this.readTiming.record(selection.key, false, performance.now() - liveStarted, selection.warmup)
      this.logger.debug('网页取帧完成', { event: 'web_source.capture.completed', context: { streamId: page.streamId, ticket: request.ticket, time: request.time, scale: request.scale, pixelWidth, pixelHeight, elapsedMs: performance.now() - startedAt, ...page.capturePath } })
      if (this.lastFailure.delete(page.streamId)) this.logger.info('网页取帧已恢复', { event: 'web_source.capture.recovered', context: { streamId: page.streamId } })
      if (unsettled && !this.unsettled.has(page.streamId)) {
        this.unsettled.add(page.streamId)
        this.logger.warn('网页在 seek 之后一直在变，取帧按最新画面（页面没按约定停住，同一时刻的画面可能不一致）', { event: 'web_source.capture.not_static', context: { streamId: page.streamId, time: request.time } })
      }
      if (text) this.logger.debug('网页文本几何采样完成', { event: 'web_source.text_geometry.completed', context: { streamId: page.streamId, ticket: request.ticket, time: text.time, sampleMs: text.sampleMs, serializationMs: text.serializationMs, bytes: text.bytes, statuses: Object.values(text.results).map(value => value.status), reasons: Object.values(text.results).flatMap(value => value.status === 'unavailable' ? [{ reason: value.reason, details: value.details ?? [] }] : []), graphemes: Object.values(text.results).reduce((sum, value) => sum + (value.status === 'ready' ? value.geometry.graphemes.length : 0), 0) } })
      return { provenance: 'live', boxes, ...(text ? { text } : {}), duration, contentHash: text?.contentHash ?? page.contentHash, pixelWidth, pixelHeight }
    } catch (error) {
      if (request.text?.length) this.logger.debug('网页文本几何采样失败', { event: 'web_source.text_geometry.failed', context: { streamId: page.streamId, ticket: request.ticket, time: request.time } })
      this.failed(page, 'web_source.capture.failed', '网页取帧失败', error, { time: request.time })
      throw error
    }
  }

  private async register(page: WebSourcePage): Promise<void> {
    if (this.pages.get(page.streamId) !== page) return
    try { await this.registrations?.register(page, this.pageTrust.get(page.streamId)) }
    catch (error) { this.logger.warn('网页后台登记不可用，继续实时网页', { event: 'web_source.registration.failed', error, context: { streamId: page.streamId } }) }
    // 热重载会撤销旧批次；已收到的最新需求跟随登记完成重放，不能由一次空登记永久丢弃。
    const demand = this.cacheDemands.get(page.streamId)
    if (demand && this.pages.get(page.streamId) === page) this.cache?.demand(page, demand)
    if (demand) this.reader?.prepare(page)
  }

  cancel(targetId: number, streamId: string, ticket: string): boolean {
    const page = this.pages.get(streamId)
    if (page?.target.id !== targetId) return false
    const cacheCancelled = this.reader?.cancel(streamId, ticket)
    const writeCancelled = this.exportWriter?.cancel(streamId, ticket)
    return page.cancel(ticket) || !!cacheCancelled || !!writeCancelled
  }

  private failed(page: WebSourcePage, event: string, message: string, error: unknown, context: Record<string, unknown> = {}): void {
    const reason = error instanceof Error ? error.message : String(error)
    if (this.lastFailure.get(page.streamId) === reason) return
    this.lastFailure.set(page.streamId, reason)
    this.logger.warn(message, { event, error, context: { streamId: page.streamId, ...context } })
  }

  close(targetId: number, streamId: string, reason = 'requested'): boolean {
    const page = this.pages.get(streamId)
    if (!page || page.target.id !== targetId) return false
    this.pages.delete(streamId)
    this.pageTrust.delete(streamId)
    this.cacheDemands.delete(streamId)
    this.readTiming.close(streamId)
    this.reader?.close(streamId)
    this.exportWriter?.close(streamId)
    this.registrations?.remove(streamId)
    this.lastFailure.delete(streamId)
    this.unsettled.delete(streamId)
    page.close()
    this.content.release(page.folder.root)
    this.logger.info('网页来源已关闭', { event: 'web_source.page.closed', context: { streamId, reason } })
    return true
  }

  closeRoute(targetId: number, route: string): number {
    const owned = [...this.pages.values()].filter(page => page.target.id === targetId && page.route === route)
    for (const page of owned) this.close(targetId, page.streamId, 'route_closed')
    return owned.length
  }

  private watchTarget(target: VideoFrameTarget): void {
    if (this.watchedTargets.has(target.id)) return
    const stop = target.onGone(reason => {
      this.watchedTargets.get(target.id)?.(); this.watchedTargets.delete(target.id)
      for (const page of [...this.pages.values()]) if (page.target.id === target.id) this.close(target.id, page.streamId, reason)
      for (const root of this.interests.get(target.id)?.keys() ?? []) this.content.release(root)
      this.interests.delete(target.id)
    })
    this.watchedTargets.set(target.id, stop)
  }

  cacheDemand(targetId: number, request: WebSourceCacheRequest): void {
    const page = this.pages.get(request.streamId)
    if (!page || page.target.id !== targetId) throw new Error('网页来源不存在或不属于当前窗口')
    this.cacheDemands.set(page.streamId, request)
    this.reader?.prepare(page)
    this.cache?.demand(page, request)
  }

  dispose(): void {
    this.exportWriter?.dispose()
    this.reader?.dispose()
    this.cache?.dispose()
    this.registrations?.dispose()
    for (const page of this.pages.values()) page.close()
    this.pages.clear()
    this.pageTrust.clear()
    this.cacheDemands.clear()
    for (const stop of this.watchedTargets.values()) stop()
    this.watchedTargets.clear()
    this.interests.clear()
    this.content.dispose()
  }
}
