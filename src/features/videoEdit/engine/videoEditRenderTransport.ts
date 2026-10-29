import { prepareVideoEditAuthorBundle } from './videoEditSharedCompiler'
import { VideoEditGpuDeviceLostError, VideoEditRenderBusyError, VideoEditRenderWorkerError } from './videoEditGpuFailure'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { SharedCompilationRequest, SharedCompilationResponse } from './videoEditSharedCompilation'
import { videoEditTimingContext, videoEditTimingEvent, type VideoEditTimingContext } from './videoEditFirstFrameTiming'
import type { EffectQuality } from '@/core/imaging/effects/descriptor'
import type { VideoProxyResult } from '@/core/videoEdit/proxy'
import { activeVideoEditClips, videoEditPictureTransitionsAt, type VideoEditComposition } from '@/core/videoEdit/document'
import { isLikelyLocalImagePath, toFetchableMediaUrl } from '@/services/imageSource'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import type { NativeFramesRequest, RenderDecodeOptions, RenderLogMessage, RenderRequest, RenderResponse } from './videoEditWorker'
import { VideoEditMediaContentVerifier } from '../videoEditMediaContent'
import type { VideoEditTrackResults } from './videoEditTrackResults'
import type { VideoEditSmartRegionSegments } from './videoEditSmartRegionMasks'
import { fontLibrarySnapshot, subscribeFontLibrary } from '@/platform/fonts'
import { loadDocumentFont, pinDocumentFonts, releaseDocumentFonts } from '@/platform/fontFaces'
import { videoEditParameterUpdate, videoEditParameterNeedsFonts } from './videoEditParameterUpdate'
import { documentCodeSourceResolver } from '@/core/videoEdit/codeMaterial/sources'
import { videoEditTransitionPictureClips } from '@/core/videoEdit/transitions'
import { videoEditNestedFrame } from '@/core/videoEdit/nestedSequences'
import { activeVideoEditEffects } from '@/core/videoEdit/compositing'
import type { AuthorModuleUrls } from './videoEditAuthorModules'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { ensureContentTrust, executeContentTrust, subscribeContentTrust } from '@/services/contentTrust'
import { authorTrustContext } from './videoEditAuthorTrust'
import { readContentTrustFailure, restoreContentTrustError } from '@/core/contentTrust'

const logger = createLogger('features.videoEdit.render')
/** 一个渲染会话同时排着的请求上限（Worker 串行执行，排得越多停止与跳转越慢）。 */
const VIDEO_EDIT_RENDER_QUEUE_LIMIT = 4
const activeTransports = new Set<VideoEditRenderTransport>()
subscribeContentTrust(command => { if (command.action === 'set-policy' && !command.allow) for (const transport of activeTransports) transport.denyForeignContent() })
// 整页刷新由窗口负责；页面确实离开后统一关闭会话，释放还在主进程持有的帧通道。
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
  for (const session of activeTransports) void session.dispose(true)
})
let nativeWarmup: Promise<void> | undefined
/** The application owns the decoder process; warming status creates no frame route or decoder session. */
export function warmVideoEditNativeDecoder(): Promise<void> {
  if (nativeWarmup) return nativeWarmup
  const started = performance.now()
  logger.info('剪辑原生解码服务开始预启动', { event: 'video_edit.decode.prewarm.start' })
  nativeWarmup = Promise.resolve().then(() => getPlatform().videoDecoder.status()).then(status => {
    logger.info('剪辑原生解码服务预启动完成', { event: 'video_edit.decode.prewarm.completed', context: { durationMs: performance.now() - started, available: status.available } })
  }).catch(error => {
    logger.warn('剪辑原生解码服务预启动未完成，打开画面时重试', { event: 'video_edit.decode.prewarm.failed', error })
  }).finally(() => { nativeWarmup = undefined })
  return nativeWarmup
}

/** A bounded request stream owned by a view/export, independent from the project lifetime. */
export interface VideoEditRenderHost {
  fonts(document: VideoEditComposition): Promise<import('@/platform/fonts').FontPayload[]>
  proxies(projectId: string, forExport: boolean): Promise<Record<string, VideoProxyResult>>
  maskUpdateTime(sequenceId: string, revision: number): number | undefined
  readCodeMetadata?(key: string): Promise<import('./videoEditAuthorMetadataCache').AuthorCachedMetadata | undefined>
  writeCodeMetadata?(key: string, metadata: import('./videoEditAuthorMetadataCache').AuthorCachedMetadata): Promise<void>
  loadCodeModules?(files: CodeMaterialFiles): Promise<AuthorModuleUrls>
}

export class VideoEditRenderTransport {
  private readonly contentTrustIds = new Set<string>()
  denyForeignContent(): void { if (this.contentTrustIds.size) void this.dispose(true) }
  private readonly compilations = new Map<number, AbortController>()
  private readonly moduleGraphs = new Map<number, AuthorModuleUrls>()
  private readonly worker = new Worker(new URL('./videoEditWorker.ts', import.meta.url), { type: 'module' })
  private readonly pending = new Map<number, { resolve: (value: RenderResponse) => void; reject: (error: Error) => void; submitted?: () => void; timer?: ReturnType<typeof setTimeout> }>()
  private nextId = 0
  private preopenVersion = 0
  private disposed = false
  private failure?: Error
  get terminated(): boolean { return this.disposed }
  get terminalError(): Error | undefined { return this.failure }
  private timing?: VideoEditTimingContext
  private async timed<T>(stage: string, operation: () => Promise<T>): Promise<T> {
    const started = performance.now()
    try { return await operation() }
    finally { if (this.timing) videoEditTimingEvent(this.timing, `render.prepare.${stage}`, { durationMs: performance.now() - started }) }
  }
  private readonly ready: Promise<RenderResponse>
  private readonly content = new VideoEditMediaContentVerifier()
  /** The frame channel handed to the worker for native decoding, disconnected after the worker is gone. */
  private route?: string
  readonly canvas: OffscreenCanvas
  get previewPreparationMs(): number { return 0 }
  get previewBytes(): number { return 0 }
  private readonly lutRoots = new Set<string>()
  private fontsRevision = -1
  private fontIds = new Set<string>()
  private stopFonts?: () => void
  private fontSync = Promise.resolve()
  /** Font syncs started and not settled yet; none means `fontScope` describes what the Worker holds. */
  private fontSyncsPending = 0
  /** `ready` has settled successfully. */
  private readySettled = false
  private fontRefresh?: Promise<void>
  private frame = -1
  private fontScope = ''
  private fontDocument?: VideoEditComposition
  /** 字体声明只取当前帧画出来的片段。嵌套序列使用对应源时间，转场两侧同时保留（停用的一侧除外）。 */
  private fontsDocument(document: VideoEditComposition): VideoEditComposition {
    const sequences: NonNullable<VideoEditComposition['sequences']> = []
    const visit = (sequence: VideoEditComposition, frame: number, seen: Set<string>): VideoEditComposition['clips'] => {
      if (seen.has(sequence.id)) return []
      seen.add(sequence.id)
      const visible = frame < 0 ? sequence.clips.filter(clip => !clip.code && !clip.effects?.some(effect => effect.code)) : [...new Map([...activeVideoEditClips(sequence, frame), ...videoEditPictureTransitionsAt(sequence, frame).flatMap(videoEditTransitionPictureClips)].map(clip => [clip.id, clip])).values()]
      const clips = visible.map(clip => clip.effects?.length ? { ...clip, effects: activeVideoEditEffects(clip) } : clip)
      for (const clip of clips) {
        const id = document.items.find(item => item.id === clip.itemId)?.sequenceId
        const nested = id && document.sequences?.find(sequence => sequence.id === id)
        if (nested) {
          // 嵌套序列没有自己的转场时不能沿用外层的，否则转场找不到所挂片段。
          const composition = { ...document, ...nested, transitions: nested.transitions, fps: nested.frameRate.numerator / nested.frameRate.denominator }
          const nestedFrame = frame < 0 ? -1 : videoEditNestedFrame(sequence, clip, composition, frame)
          sequences.push({ ...nested, clips: visit(composition, nestedFrame, new Set(seen)) })
        }
      }
      return clips
    }
    const clips = visit(document, this.frame, new Set())
    return { ...document, clips, items: [], sequences }
  }
  /** The view schedules font redraws through its existing frame loop, never an independent request stream. */
  fontPresentationRevision = 0
  private syncFonts(document: VideoEditComposition): Promise<void> {
    this.fontSyncsPending++
    const result = this.fontSync.catch(() => undefined).then(() => this.applyFonts(document)).finally(() => { this.fontSyncsPending-- })
    this.fontSync = result
    return result
  }
  private fontKey(document: VideoEditComposition): string {
    const scoped = this.fontsDocument(document)
    return JSON.stringify([scoped.clips.map(clip => clip.id), scoped.sequences?.map(sequence => [sequence.id, sequence.clips.map(clip => clip.id)]), fontLibrarySnapshot().revision])
  }
  private async applyFonts(document: VideoEditComposition): Promise<void> {
    const scoped = this.fontsDocument(document)
    const key = this.fontKey(document)
    if (document === this.fontDocument && key === this.fontScope) return
    const fonts = await this.host.fonts(scoped)
    if (this.disposed) return
    pinDocumentFonts(this, fonts.map(payload => payload.face.id))
    await Promise.all(fonts.map(loadDocumentFont))
    const revision = fontLibrarySnapshot().revision
    const changed = revision !== this.fontsRevision
    const additions = fonts.filter(payload => changed || !this.fontIds.has(payload.face.id))
    const usedIds = new Set(fonts.map(payload => payload.face.id))
    const removed = [...this.fontIds].some(id => !usedIds.has(id))
    if (additions.length || removed || changed && this.fontsRevision >= 0) await this.request({ kind: 'fonts', fonts: additions, availableIds: [...usedIds], reset: changed && this.fontsRevision >= 0 })
    this.fontsRevision = revision
    this.fontIds = usedIds
    this.fontScope = key
    this.fontDocument = document
    if (additions.length || removed || changed) this.fontPresentationRevision++
  }
  private async authorizeLuts(document: VideoEditComposition): Promise<void> {
    for (const asset of [...(document.colorLuts ?? []), ...document.media.flatMap(media => media.recordingCursor?.pages ?? [])]) {
      // Capture logs may contain thousands of pages under one authorized directory.
      const normalized = asset.path.replace(/\\/g, '/')
      const directoryKey = normalized.slice(0, normalized.lastIndexOf('/'))
      if (this.lutRoots.has(directoryKey)) continue
      const platform = getPlatform()
      await platform.media.allowRoot(await platform.system.paths.dirname(asset.path))
      this.lutRoots.add(directoryKey)
    }
  }
  private proxies: Record<string, VideoProxyResult> = {}
  private async selectProxies(original = false): Promise<void> { this.proxies = this.proxyProjectId && !original ? await this.host.proxies(this.proxyProjectId, this.exportProxies) : {} }
  private proxySources(): Record<string, VideoProxyResult> { return Object.fromEntries(Object.entries(this.proxies).map(([id, result]) => [id, { ...result, path: toFetchableMediaUrl(result.path) }])) }
  private mediaDocument(document: VideoEditComposition): VideoEditComposition { return { ...document, media: document.media.map(media => ({ ...media, path: toFetchableMediaUrl(media.path), ...(media.recordingCursor ? { recordingCursor: { ...media.recordingCursor, pages: media.recordingCursor.pages.map(page => ({ ...page, path: toFetchableMediaUrl(page.path) })) } } : {}), ...(this.proxies[media.id] ? { sourceRevision: `${media.sourceRevision ?? ''}:proxy:${this.proxies[media.id].key}` } : {}) })), ...(document.colorLuts ? { colorLuts: document.colorLuts.map(asset => ({ ...asset, path: toFetchableMediaUrl(asset.path) })) } : {}) } }
  /** The native decoder reads original local files; the worker only sees fetchable URLs, so it gets this map too. */
  private localPaths(document: VideoEditComposition): Record<string, string> {
    return Object.fromEntries([...Object.values(this.proxies).map(result => [toFetchableMediaUrl(result.path), result.path]), ...document.media.filter(media => media.kind !== 'image' && isLikelyLocalImagePath(media.path)).map(media => [toFetchableMediaUrl(media.path), media.path])])
  }
  /**
   * Native decoding for this session: the service state, the diagnostic setting, and a frame channel whose port goes
   * to the worker before `init`. Any failure leaves the session on browser decoding alone (logged).
   */
  private async connectNative(): Promise<Omit<RenderDecodeOptions, 'localPaths'>> {
    let forced: RenderDecodeOptions['forced']
    try {
      const platform = getPlatform()
      const status = await this.timed('native_status', () => platform.videoDecoder.status())
      forced = status.forcedBackend ?? undefined
      if (!status.available || forced === 'browser' || this.disposed) return { nativeAvailable: false, ...(forced ? { forced } : {}) }
      const channel = await this.timed('native_connect', () => platform.videoFrames.connect())
      if (this.disposed) { platform.videoFrames.disconnect(channel.route); return { nativeAvailable: false } }
      this.route = channel.route
      this.worker.postMessage({ kind: 'nativeFrames.attach', port: channel.port } satisfies NativeFramesRequest, [channel.port])
      return { nativeAvailable: true, ...(forced ? { forced } : {}) }
    } catch (error) {
      logger.warn('原生解码通道不可用，剪辑预览只用后备解码', { event: 'video_edit.decode.native.channel_failed', error })
      return { nativeAvailable: false, ...(forced ? { forced } : {}) }
    }
  }
  constructor(private readonly host: VideoEditRenderHost, private document: VideoEditComposition, previewWidth?: number, _preparing?: (active: boolean) => void, surface?: OffscreenCanvas, cacheBudgetBytes?: number, private proxyProjectId?: string, private readonly exportProxies = false, private readonly requestTimeoutMs = 60_000) {
    activeTransports.add(this)
    this.timing = videoEditTimingContext(proxyProjectId, document.id)
    if (this.timing) videoEditTimingEvent(this.timing, 'render.session.start')
    // Preview owns the transferred full-size surface; reserve the export scratch lazily.
    this.canvas = new OffscreenCanvas(previewWidth ? 1 : document.width, previewWidth ? 1 : document.height)
    this.worker.onmessage = (event: MessageEvent<RenderResponse | RenderLogMessage | SharedCompilationRequest>) => {
      // 终止之后已排队的消息仍可能送达，不能重新打开模块、源码或任何请求通道。
      if (this.disposed && ('kind' in event.data ? event.data.kind !== 'log' : !this.pending.has(event.data.id))) {
        if (!('kind' in event.data)) { event.data.bitmap?.close(); event.data.history?.close() }
        return
      }
      if ('kind' in event.data && event.data.kind === 'code.releaseModules') {
        this.moduleGraphs.get(event.data.token)?.dispose(); this.moduleGraphs.delete(event.data.token); return
      }
      if ('kind' in event.data && event.data.kind === 'code.trust') {
        const { token, request } = event.data
        const context = request.context ?? (request.url ? authorTrustContext(request.url) : undefined)
        const checked = context ? ensureContentTrust({ contents: context }).then(async () => {
          const { records } = await executeContentTrust({ action: 'check', query: { contents: context } })
          for (const record of records) this.contentTrustIds.add(record.id)
          
        }) : Promise.reject(new Error('代码来源无法确认，代码尚未运行。'))
        void checked.then(() => ({}), error => ({ error: error instanceof Error ? error.message : String(error), contentTrust: readContentTrustFailure(error) })).then(result => {
          if (!this.disposed) this.worker.postMessage({ kind: 'code.trustResult', token, ...result } satisfies SharedCompilationResponse)
        })
        return
      }
      if ('kind' in event.data && event.data.kind === 'code.modules') {
        const { token, files } = event.data
        const prepared = this.host.loadCodeModules ? this.host.loadCodeModules(files) : Promise.reject(new Error('此会话未提供循环模块加载入口。'))
        void prepared.then(modules => {
          if (this.disposed) { modules.dispose(); return }
          this.moduleGraphs.set(token, modules)
          this.worker.postMessage({ kind: 'code.moduleUrls', token, url: modules.url } satisfies SharedCompilationResponse)
        }, error => { if (!this.disposed) this.worker.postMessage({ kind: 'code.moduleUrls', token, error: error instanceof Error ? error.message : String(error), contentTrust: readContentTrustFailure(error) } satisfies SharedCompilationResponse) })
        return
      }
      if ('kind' in event.data && event.data.kind === 'code.metadata') {
        const { token, key, metadata } = event.data
        const work = metadata ? Promise.resolve(this.host.writeCodeMetadata?.(key, metadata)).then(() => undefined) : Promise.resolve(this.host.readCodeMetadata?.(key))
        void work.catch(() => undefined).then(metadata => { if (!this.disposed) this.worker.postMessage({ kind: 'code.metadataResult', token, metadata } satisfies SharedCompilationResponse) })
        return
      }
      if ('kind' in event.data && event.data.kind === 'code.read') {
        const { token, file } = event.data
        void (file.location.startsWith('memory:') ? Promise.resolve(documentCodeSourceResolver().read(file.hash, file.location, file.path)) : getPlatform().documents.readCodeFile(file)).then(
          source => ({ kind: 'code.source' as const, token, source }),
          error => ({ kind: 'code.source' as const, token, error: error instanceof Error ? error.message : String(error), contentTrust: readContentTrustFailure(error) }),
        ).then(result => { if (!this.disposed) this.worker.postMessage(result satisfies SharedCompilationResponse) })
        return
      }
      if ('kind' in event.data && event.data.kind === 'code.cancel') {
        this.compilations.get(event.data.token)?.abort(); this.compilations.delete(event.data.token); return
      }
      if ('kind' in event.data && event.data.kind === 'code.compile') {
        const { token, files } = event.data; const controller = new AbortController()
        this.compilations.set(token, controller)
        const started = performance.now()
        const prepared = prepareVideoEditAuthorBundle(files, controller.signal).then(bundle => ({ id: token, bundle }))
        void prepared.then(
          result => result,
          error => ({ id: token, error: { code: error instanceof CodeMaterialError ? error.code : 'CONTEXT' as const, message: error instanceof Error ? error.message : String(error), contentTrust: readContentTrustFailure(error), ...(error instanceof CodeMaterialError ? { sourceSpan: error.sourceSpan } : {}) } }),
        ).then(result => {
          this.compilations.delete(token)
          if (!this.disposed && !controller.signal.aborted) this.worker.postMessage({ kind: 'code.compiled', token, result } satisfies SharedCompilationResponse)
          logger.debug('共享源码准备完成', { event: 'video_edit.code.shared_compile.completed', context: { durationMs: performance.now() - started } })
        })
        return
      }
      if ('kind' in event.data) {
        const entry = event.data
        logger[entry.level](entry.message, { event: entry.event, context: entry.context })
        if (entry.event === 'video_edit.render.worker.uncaught_error') {
          const { message, filename, line, column } = entry.context
          this.fail(new VideoEditRenderWorkerError('剪辑画面处理已中断，请重新加载预览。', undefined, { message: typeof message === 'string' ? message : entry.message, ...(typeof filename === 'string' ? { filename } : {}), ...(typeof line === 'number' ? { line } : {}), ...(typeof column === 'number' ? { column } : {}) }))
        }
        return
      }
      const value = event.data; const pending = this.pending.get(value.id)
      if (value.phase === 'submitted') { pending?.submitted?.(); return }
      this.pending.delete(value.id)
      if (!pending) { value.bitmap?.close(); value.history?.close(); return }
      clearTimeout(pending.timer)
      if (value.error) pending.reject(value.gpuDeviceLost !== undefined ? new VideoEditGpuDeviceLostError(value.gpuDeviceLost) : restoreContentTrustError(new Error(value.error), value.contentTrust)); else pending.resolve(value)
    }
    this.worker.onerror = event => {
      event.preventDefault?.()
      const original: unknown = event.error
      const error = new VideoEditRenderWorkerError('剪辑画面处理已中断，请重新加载预览。', original instanceof Error ? { cause: original } : undefined, { message: event.message, filename: event.filename, line: event.lineno, column: event.colno })
      this.fail(error, { filename: event.filename, line: event.lineno, column: event.colno, workerMessage: event.message })
    }
    this.worker.onmessageerror = () => this.fail(new VideoEditRenderWorkerError('剪辑画面结果无法读取，请重新加载预览。'))
    // Verify original media before dependent code/font preparation or opening a decoder channel.
    this.ready = this.timed('content', () => this.content.check(document)).then(() => Promise.all([this.timed('proxies', () => this.selectProxies()), this.connectNative(), this.timed('luts', () => this.authorizeLuts(document)), this.timed('fonts', () => this.syncFonts(document))])).then(async ([, decode]) => { const codeSources = await this.timed('code', () => this.codeSources(document)); return this.timed('init', () => this.request({ kind: 'init', timing: this.timing, document: this.mediaDocument(document), codeSources, previewWidth, surface, cacheBudgetBytes, decode: { ...decode, localPaths: this.localPaths(document), proxies: this.proxySources() } }, surface ? [surface] : [])) })
    void this.ready.then(() => { this.readySettled = true }, () => undefined)
    this.stopFonts = subscribeFontLibrary(() => {
      if (this.disposed || this.fontRefresh || fontLibrarySnapshot().revision === this.fontsRevision) return
      this.fontRefresh = this.ready.then(async () => {
        while (!this.disposed && fontLibrarySnapshot().revision !== this.fontsRevision) await this.syncFonts(this.document)
      }).catch(error => logger.warn('剪辑字体更新失败', { event: 'video_edit.fonts.update.failed', error })).finally(() => { this.fontRefresh = undefined })
    })
    void this.ready.catch(() => undefined)
  }
  /** An empty pooled session gets exactly one project owner before any project content is loaded. */
  adoptProject(projectId: string): void {
    if (this.disposed || this.proxyProjectId) throw new Error('节目会话已经被接管或释放。')
    this.proxyProjectId = projectId
  }
  async prepareGpu(): Promise<void> { await this.ready; await this.request({ kind: 'prepareGpu' }) }
  async releaseAuthor(url: string): Promise<void> { await this.ready; await this.request({ kind: 'authorRelease', url }) }
  async readAuthorMetadata(url: string, locations?: import('./videoEditAuthorBundle').AuthorSourceLocations, apiVersion?: number): Promise<import('./videoEditAuthorParameters').AuthorEffectMetadata> {
    await this.ready
    const result = await this.request({ kind: 'authorMetadata', url, locations, apiVersion })
    if (!result.authorMetadata) throw new Error('作者模块未返回参数声明，请重新检查源码。')
    return result.authorMetadata
  }
  /** An unresponsive author shares this worker; terminate the whole session and
   * let its existing owner/pool rebuild. Never automatically replay hung source. */
  private fail(error: Error, detail: Record<string, unknown> = {}): void {
    if (this.disposed) return
    this.failure = error; this.disposed = true
    activeTransports.delete(this)
    this.worker.terminate()
    for (const modules of this.moduleGraphs.values()) modules.dispose()
    this.moduleGraphs.clear()
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    for (const controller of this.compilations.values()) controller.abort()
    this.compilations.clear(); this.stopFonts?.(); releaseDocumentFonts(this); this.content.dispose()
    this.canvas.width = this.canvas.height = 1
    this.disconnectNative()
    logger.warn('剪辑渲染会话已中止', { event: 'video_edit.render.session.failed', error, context: { sequenceId: this.document.id, ...detail } })
  }
  private disconnectNative(): void {
    if (!this.route) return
    const route = this.route; this.route = undefined
    try { getPlatform().videoFrames.disconnect(route) } catch { /* the platform is gone with the page */ }
  }
  private request(request: RenderRequest extends infer T ? T extends RenderRequest ? Omit<T, 'id'> : never : never, transfer: Transferable[] = [], submitted?: () => void): Promise<RenderResponse> {
    if (this.disposed) return Promise.reject(this.failure ?? new Error('剪辑渲染已关闭。'))
    // 最后一道防线：调用方应先按自己的在途数限流（节目预览见 VideoEditPreview），排满时按背压拒绝。
    if (this.pending.size >= VIDEO_EDIT_RENDER_QUEUE_LIMIT) return Promise.reject(new VideoEditRenderBusyError())
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('剪辑渲染超过时限，已停止当前画面任务。请检查代码效果后重新加载预览；已保存的作品不受影响。')), this.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, submitted, timer })
      try { this.worker.postMessage({ ...request, id }, transfer) }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  // 初始化只传清单，Worker 在当前帧或预热窗口真正需要时请求文件。
  private codeSources(_document: VideoEditComposition): Promise<Record<string, string>> { return Promise.resolve({}) }
  async updateDocument(document: VideoEditComposition, original = false): Promise<void> {
    await this.ready
    this.timing = videoEditTimingContext(this.proxyProjectId, document.id)
    // Asking for originals only needs a rebuild when proxies are loaded; otherwise a parameter edit keeps the fast path.
    const update = (!original || Object.keys(this.proxies).length === 0) && videoEditParameterUpdate(this.document, document)
    if (update) {
      if (videoEditParameterNeedsFonts(this.document, update)) await this.syncFonts(document)
      await this.request({ kind: 'parameters', update }); this.document = document; return
    }
    const started = performance.now(); const steps: Record<string, number> = {}
    const step = async (name: string, work: Promise<unknown>): Promise<void> => { const at = performance.now(); await work; steps[name] = Math.round(performance.now() - at); if (this.timing) videoEditTimingEvent(this.timing, `render.update.${name}`, { durationMs: steps[name] }) }
    await step('proxies', this.selectProxies(original)); await step('content', this.content.check(document)); await step('luts', this.authorizeLuts(document)); await step('fonts', this.syncFonts(document))
    let codeSources: Record<string, string> = {}
    await step('code', this.codeSources(document).then(value => { codeSources = value }))
    await step('worker', this.request({ kind: 'update', timing: this.timing, document: this.mediaDocument(document), codeSources, localPaths: this.localPaths(document), proxies: this.proxySources() })); this.document = document
    logger.info('剪辑渲染文档已更新', { event: 'video_edit.render.document.updated', context: { sequenceId: document.id, durationMs: Math.round(performance.now() - started), steps } })
  }
  /** Exclusive offscreen lease boundary. Candidate revisions need not be monotonic. */
  async replaceContent(document: VideoEditComposition): Promise<void> {
    await this.ready
    await this.content.check(document)
    await this.authorizeLuts(document)
    await this.syncFonts(document)
    const codeSources = await this.codeSources(document)
    await this.request({ kind: 'replaceContent', document: this.mediaDocument(document), codeSources, localPaths: this.localPaths(document) })
    this.document = document
    this.canvas.width = document.width; this.canvas.height = document.height
  }
  /** Called by the sequence change notification before React commits the new panels. */
  preopenSequence(document: VideoEditComposition, frame: number): void {
    const version = ++this.preopenVersion
    void this.ready.then(async () => {
      await this.content.check(document)
      if (this.disposed || version !== this.preopenVersion) return
      const mapped = this.mediaDocument(document)
      this.worker.postMessage({ kind: 'preopen', id: 0, document: mapped, frame, localPaths: this.localPaths(document), timing: videoEditTimingContext(this.proxyProjectId, document.id) } satisfies RenderRequest)
    }).catch(error => { if (!this.disposed && version === this.preopenVersion) logger.info('序列预打开未完成，按正式渲染路径检查素材', { event: 'video_edit.render.preopen.skipped', error, context: { sequenceId: document.id } }) })
  }
  /** Preview only (task 4.9): later frames draw at 1/divisor of the sequence size; resolves once the worker applied it. */
  async setRenderDivisor(divisor: number): Promise<void> { await this.ready; await this.request({ kind: 'scale', divisor }) }
  /** Paused preview only: positions forward playback at this frame ahead of play, so pressing play starts at once. */
  async armPlayback(frame: number): Promise<void> { await this.ready; await this.request({ kind: 'arm', frame }) }
  /**
   * Ends a play run: the Worker cancels at once every playback frame (one with a deadline) sent before this call and not
   * on screen yet (answered `skipped`), then releases the playback decoders in queue order. Send it before the request of
   * the frame that follows (the paused frame, a new run).
   */
  stopPlayback(frame: number): void { if (!this.disposed) this.worker.postMessage({ kind: 'stopPlayback', id: 0, frame } satisfies RenderRequest) }
  /** 智能区域（4.7d）：已分析好的段落交给 Worker，下一次渲染即使用。 */
  setSmartRegions(regions: VideoEditSmartRegionSegments): void { if (!this.disposed) this.worker.postMessage({ kind: 'regions', regions, id: 0 } satisfies RenderRequest) }
  /** Ready pre-rendered windows of the current sequence (program playback only); local files map to worker URLs here. */
  setRenderCache(windows: ReadonlyArray<Omit<import('./videoEditRenderer').VideoEditRenderCacheWindow, 'url'> & { path: string }>): void {
    if (this.disposed) return
    this.worker.postMessage({ kind: 'renderCache', id: 0, windows: windows.map(({ path, ...window }) => ({ ...window, url: toFetchableMediaUrl(path) })), localPaths: Object.fromEntries(windows.map(window => [toFetchableMediaUrl(window.path), window.path])) } satisfies RenderRequest)
  }
  setTracks(tracks: VideoEditTrackResults): void { if (!this.disposed) this.worker.postMessage({ kind: 'tracks', tracks, id: 0 } satisfies RenderRequest) }
  invalidateDocument(revision: number): void { if (!this.disposed) this.worker.postMessage({ kind: 'invalidate', revision, id: 0 } satisfies RenderRequest) }
  async present(frame: number, sequential = false, scrubbing: import('./videoEditRenderer').VideoEditScrubMode = false, deadline?: number, submitted?: () => void, readRgb?: { width: number; height: number }, quality: EffectQuality = 'interactive', history = false, observeElements = false): Promise<RenderResponse> {
    // 会话已就绪、这一帧要的字体也已在 Worker 里时不经任何等待，请求在调用方的同一个任务里发出（拖动时不排到界面更新之后）。
    if (!this.readySettled) await this.ready
    this.frame = frame
    if (this.fontSyncsPending || this.document !== this.fontDocument || this.fontKey(this.document) !== this.fontScope) await this.syncFonts(this.document)
    const document = this.document
    const result = await this.request({ kind: 'render', frame, sequential, scrubbing, deadline, quality, ...(observeElements ? { observeElements: true } : {}), ...(readRgb ? { readRgb } : {}), ...(history ? { history: true } : {}) }, [], submitted)
    const at = result.presented ? this.host.maskUpdateTime(document.id, document.revision) : undefined
    if (at !== undefined && result.presented) {
      const durationMs = performance.now() - at
      logger.debug('遮罩更新出画', { event: 'video_edit.mask.present.completed', context: { sequenceId: document.id, revision: document.revision, frame, durationMs, displayFrames: durationMs * document.fps / 1000, gpuMs: result.gpuMs } })
    }
    return result
  }
  async renderBitmap(frame: number, sequential = false, scrubbing = false, quality: EffectQuality = 'interactive'): Promise<RenderResponse & { bitmap: ImageBitmap }> {
    const result = await this.present(frame, sequential, scrubbing, undefined, undefined, undefined, quality)
    if (!result.bitmap) throw new Error('剪辑渲染没有返回画面。')
    return { ...result, bitmap: result.bitmap }
  }
  /** Export frames: sequential renders on this session's full-size canvas (task 2.4: exact pictures or a failure). */
  async render(frame: number, sequential = false): Promise<{ canvas: OffscreenCanvas; sourceTimestamps: number[]; singleFrameReads: number }> {
    const result = await this.renderBitmap(frame, sequential, false, 'final')
    try { this.canvas.getContext('2d')!.drawImage(result.bitmap, 0, 0) } finally { result.bitmap.close() }
    return { canvas: this.canvas, sourceTimestamps: result.sourceTimestamps ?? [], singleFrameReads: result.singleFrameReads ?? 0 }
  }
  /** `retainIdle`：拖动播放头的声音颗粒，保留最近用过的空闲声音来源，避免每个颗粒重开会话。 */
  async mixAudio(start: number, duration: number, retainIdle = false): Promise<AudioBuffer> {
    await this.ready
    const { channels } = await this.request({ kind: 'audio', start, duration, ...(retainIdle ? { retainIdle } : {}) })
    if (!channels?.length) throw new Error('剪辑混音没有返回声音。')
    const buffer = new AudioBuffer({ numberOfChannels: channels.length, sampleRate: this.document.sampleRate, length: channels[0].length })
    channels.forEach((channel, index) => buffer.getChannelData(index).set(channel))
    return buffer
  }
  async dispose(immediate = false): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    activeTransports.delete(this)
    for (const controller of this.compilations.values()) controller.abort()
    this.compilations.clear()
    this.stopFonts?.()
    releaseDocumentFonts(this)
    this.content.dispose()
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('剪辑渲染已关闭。')) }
    this.pending.clear()
    if (immediate) {
      this.worker.terminate(); this.canvas.width = this.canvas.height = 1
      for (const modules of this.moduleGraphs.values()) modules.dispose()
      this.moduleGraphs.clear(); this.disconnectNative()
      return
    }
    const id = ++this.nextId
    let timer: ReturnType<typeof setTimeout> | undefined
    const closed = new Promise<RenderResponse>((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ kind: 'dispose', id } satisfies RenderRequest) })
    const limit = new Promise<void>(resolve => { timer = setTimeout(resolve, 2000) })
    await Promise.allSettled([Promise.race([closed, limit])])
    clearTimeout(timer); this.worker.terminate(); this.pending.clear(); this.canvas.width = 1; this.canvas.height = 1
    for (const modules of this.moduleGraphs.values()) modules.dispose()
    this.moduleGraphs.clear()
    // Closes the port and any native session the worker could not close itself.
    this.disconnectNative()
  }
}
