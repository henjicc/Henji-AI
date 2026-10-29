import { codeWebBoxesIssue, codeWebView } from '../../../../src/core/videoEdit/codeMaterial/webSource'
import type { WebSourceCaptureRequest, WebSourceCaptureResult, WebSourceContentChange, WebSourceInfo, WebSourceOpenRequest } from '../../../../src/platform/contracts/videoFrameTypes'
import type { MainLogger } from '../logging/main-logger'
import type { VideoFrameTarget } from '../video-decoder'
import { WebSourceContent } from './content'
import { WebSourcePage } from './page'
import { resolveWebSourceFolder } from './site'

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
  const view = codeWebView({ width: fields.width as number, height: fields.height as number, region: fields.region as number[], scale: fields.scale as number })
  return { route: fields.route, path: sourcePath(fields.path), ...view }
}

export function parseWebSourceCaptureRequest(input: unknown): WebSourceCaptureRequest {
  const fields = record(input, '网页取帧请求')
  for (const key of ['streamId', 'ticket'] as const) if (typeof fields[key] !== 'string' || !ID_PATTERN.test(fields[key] as string)) throw new Error(`网页取帧参数 ${key} 无效`)
  if (typeof fields.time !== 'number' || !Number.isFinite(fields.time) || fields.time < 0) throw new Error('网页取帧参数 time 需要非负秒数')
  if (fields.boxes !== undefined) { const issue = codeWebBoxesIssue(fields.boxes); if (issue) throw new Error(issue) }
  return { streamId: fields.streamId as string, ticket: fields.ticket as string, time: fields.time, ...(fields.boxes ? { boxes: fields.boxes as string[] } : {}) }
}

export function parseWebSourcePath(input: unknown): string { return sourcePath(record(input, '网页来源请求').path) }

/**
 * 网页来源的离屏页面：每个页面归属打开它的窗口与帧通道（通道断开、窗口导航或关闭时一并关掉），取帧只能操作本窗口的页面。
 * 同一通道里同一来源与取景只开一个页面由渲染层保证（它按来源与取景复用会话）。
 */
export class WebSourcePages {
  private readonly pages = new Map<string, WebSourcePage>()
  private readonly watchedTargets = new Map<number, () => void>()
  /** 每个页面上一次记下的失败原因：页面坏掉时每帧都会失败，同一原因只记一次，恢复或原因变了再记。 */
  private readonly lastFailure = new Map<string, string>()
  /** 每个网页路径上一次打开失败的原因：打不开时渲染层每帧重试，同一原因只记一次，打开成功或原因变了再记。 */
  private readonly lastOpenFailure = new Map<string, string>()
  /** 已记过“页面没停住”的页面。 */
  private readonly unsettled = new Set<string>()
  private nextId = 1
  private readonly content: WebSourceContent

  constructor(private readonly logger: Pick<MainLogger, 'info' | 'warn'>, broadcast: (change: WebSourceContentChange) => void) {
    this.content = new WebSourceContent((root, contentHash, paths) => {
      for (const page of this.pages.values()) if (page.folder.root === root) {
        void page.reload(contentHash).then(
          () => this.logger.info('网页来源已按新内容重新载入', { event: 'web_source.page.reloaded', context: { streamId: page.streamId, contentHash } }),
          error => this.failed(page, 'web_source.page.reload_failed', '网页来源重新载入失败', error),
        )
      }
      for (const path of paths) broadcast({ path, contentHash })
    }, logger)
  }

  /** 网页文件夹的内容指纹（预渲染窗口指纹用；内容变化按这个路径通知）。 */
  async contentHash(path: string): Promise<string> {
    const folder = await resolveWebSourceFolder(path)
    return this.content.hash(folder.root, path)
  }

  async open(target: VideoFrameTarget, request: WebSourceOpenRequest): Promise<WebSourceInfo> {
    if (target.isDestroyed()) throw new Error('目标窗口已关闭')
    const startedAt = Date.now()
    const streamId = `web-${this.nextId++}`
    const { route, path, ...view } = request
    const context = { streamId, targetId: target.id, route, path, width: view.width, height: view.height, region: view.region, scale: view.scale }
    const retrying = this.lastOpenFailure.has(path)
    if (!retrying) this.logger.info('打开网页来源', { event: 'web_source.page.open.start', context })
    let page: WebSourcePage | undefined
    let retained: string | undefined
    try {
      const folder = await resolveWebSourceFolder(path)
      const contentHash = await this.content.retain(folder.root)
      retained = folder.root
      page = new WebSourcePage(streamId, target, route, folder, view, contentHash, reason => this.logger.warn('网页来源页面进程退出，下一次取帧时重新载入', { event: 'web_source.page.gone', context: { streamId, reason } }))
      this.pages.set(streamId, page)
      this.watchTarget(target)
      await page.open()
    } catch (error) {
      this.pages.delete(streamId)
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
    this.logger.info('网页来源已打开', { event: 'web_source.page.open.completed', context: { ...context, elapsedMs: Date.now() - startedAt, pixelWidth: page.pixelWidth, pixelHeight: page.pixelHeight, duration: page.duration, contentHash: page.contentHash } })
    return { streamId, route, contentHash: page.contentHash, duration: page.duration, pixelWidth: page.pixelWidth, pixelHeight: page.pixelHeight }
  }

  async capture(targetId: number, request: WebSourceCaptureRequest): Promise<WebSourceCaptureResult> {
    const page = this.pages.get(request.streamId)
    if (!page || page.target.id !== targetId) throw new Error('网页来源不存在或不属于当前窗口')
    try {
      const { boxes, duration, unsettled } = await page.capture(request.time, request.ticket, request.boxes)
      if (this.lastFailure.delete(page.streamId)) this.logger.info('网页取帧已恢复', { event: 'web_source.capture.recovered', context: { streamId: page.streamId } })
      if (unsettled && !this.unsettled.has(page.streamId)) {
        this.unsettled.add(page.streamId)
        this.logger.warn('网页在 seek 之后一直在变，取帧按最新画面（页面没按约定停住，同一时刻的画面可能不一致）', { event: 'web_source.capture.not_static', context: { streamId: page.streamId, time: request.time } })
      }
      return { boxes, duration, contentHash: page.contentHash }
    } catch (error) {
      this.failed(page, 'web_source.capture.failed', '网页取帧失败', error, { time: request.time })
      throw error
    }
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
    })
    this.watchedTargets.set(target.id, stop)
  }

  dispose(): void {
    for (const page of this.pages.values()) page.close()
    this.pages.clear()
    for (const stop of this.watchedTargets.values()) stop()
    this.watchedTargets.clear()
    this.content.dispose()
  }
}
