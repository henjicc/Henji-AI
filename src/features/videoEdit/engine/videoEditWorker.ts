import { VideoEditContentWarmup } from './videoEditContentWarmup'
import { enableVideoEditFrameTrace, traceVideoEditFrame } from './videoEditFrameTrace'
import { VideoEditSharedCompilation, type SharedCompilationResponse } from './videoEditSharedCompilation'
import { setVideoEditCodeCompilerWorkerFactory } from './videoEditCodeCompiler'
import { videoEditPreparationSnapshot, recordVideoEditPreparation } from './videoEditPreparationTiming'
import type { VideoEditTimingContext } from './videoEditFirstFrameTiming'
import type { EffectQuality } from '@/core/imaging/effects/descriptor'
import { VideoEditProxyFrames } from './videoEditProxyFrames'
import type { VideoProxyResult } from '@/core/videoEdit/proxy'
import { VideoEditRenderer } from './videoEditRenderer'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { VideoEditNativeFrameReceiver } from './videoEditNativeFrames'
import { NativeFrameDiagnostics, type NativeFrameDiagnosticsRequest, type NativeFrameDiagnosticsResult } from './videoEditNativeFrameDiagnostics'
import { VideoEditBrowserFrames } from './videoEditBrowserFrames'
import { VideoEditNativeFrames } from './videoEditNativeFrameSource'
import { VideoEditFrameRouter, type VideoEditDecodeSettings } from './videoEditFrameRouter'
import { setVideoEditTrackResults, type VideoEditTrackResults } from './videoEditTrackResults'
import { setVideoEditSmartRegionSegments, type VideoEditSmartRegionSegments } from './videoEditSmartRegionMasks'
import { readVideoEditTrackingRgb } from './videoEditTrackingPixels'
import { setVideoEditMaskTimingObserver } from './videoEditEffectMasks'
import { LoadedFontFaces } from '@/platform/fontFaces'
import { receiveCodeSourceTexts } from '@/core/videoEdit/codeMaterial/sources'
import type { FontPayload } from '@/platform/fonts'
import type { VideoEditParameterUpdate } from './videoEditParameterUpdate'

/**
 * Decoding settings of one render session. `localPaths` maps each media item's fetchable URL (its path in the worker)
 * to the local file the native decoder reads.
 */
export interface RenderDecodeOptions extends VideoEditDecodeSettings { localPaths?: Record<string, string>; proxies?: Record<string, VideoProxyResult> }
export type RenderRequest = { id: number } & (
  { kind: 'fonts'; fonts: FontPayload[]; availableIds: string[]; reset: boolean } |
  { kind: 'init'; traceFrames?: boolean; timing?: VideoEditTimingContext; document: VideoEditComposition; codeSources?: Record<string, string>; previewWidth?: number; surface?: OffscreenCanvas; cacheBudgetBytes?: number; decode?: RenderDecodeOptions } | { kind: 'update'; timing?: VideoEditTimingContext; document: VideoEditComposition; codeSources?: Record<string, string>; localPaths?: Record<string, string>; proxies?: Record<string, VideoProxyResult> }
  | { kind: 'replaceContent'; document: VideoEditComposition; codeSources?: Record<string, string>; localPaths: Record<string, string> }
  | { kind: 'invalidate'; revision: number }
  | { kind: 'parameters'; update: VideoEditParameterUpdate }
  /** Preview playback resolution (task 4.9): the next renders draw at 1/divisor of the sequence size. */
  | { kind: 'scale'; divisor: number }
  | { kind: 'arm'; frame: number }
  | { kind: 'prepareGpu' }
  | { kind: 'authorMetadata'; url: string; locations?: import('./videoEditAuthorBundle').AuthorSourceLocations }
  | { kind: 'authorFrame'; assets?: Record<string, ImageBitmap>; url: string; params: import('./videoEditAuthorModule').AuthorParameters; info: import('./videoEditAuthorModule').AuthorFrameInfo; options?: Parameters<VideoEditRenderer['renderAuthorFrame']>[4] }
  | { kind: 'preopen'; media: VideoEditComposition['media']; localPaths: Record<string, string>; timing?: VideoEditTimingContext }
  /** 已分析好的智能区域段落（4.7d），按素材地址与分析种类；不进渲染队列，下一次渲染即生效。 */
  | { kind: 'tracks'; tracks: VideoEditTrackResults }
  | { kind: 'regions'; regions: VideoEditSmartRegionSegments }
  | { kind: 'dispose' }
  | { kind: 'render'; quality?: EffectQuality; frame: number; sequential: boolean; scrubbing?: boolean; deadline?: number; readRgb?: { width: number; height: number }; history?: boolean }
  | { kind: 'audio'; start: number; duration: number }
  /** Acceptance probes only (task 2.7): high-precision counters and one row of the last high-precision composition. */
  | { kind: 'precision'; row?: number })
export type RenderResponse = { authorMetadata?: import('./videoEditAuthorParameters').AuthorEffectMetadata; elements?: import('./videoEditAuthorElements').AuthorElementObservation[]; preparationStages?: ReturnType<typeof videoEditPreparationSnapshot>; codePerformance?: import('@/core/videoEdit/codeMaterial/performance').CodeFramePerformance[]; id: number; phase?: 'submitted'; error?: string; effectErrors?: string[]; bitmap?: ImageBitmap; history?: ImageBitmap; rgb?: Uint8Array; sourceTimestamps?: number[]; blankPictures?: number; singleFrameReads?: number; channels?: Float32Array[]; cacheHits?: number; cacheBytes?: number; presented?: boolean; decodeMs?: number; gpuMs?: number; codeResources?: ReturnType<VideoEditRenderer['codeDiagnostics']>; precision?: Awaited<ReturnType<VideoEditRenderer['precisionDiagnostics']>> }
/** Structured log entries the worker cannot write itself; the render session forwards them to the application log. */
export interface RenderLogMessage { kind: 'log'; level: 'debug' | 'info' | 'warn'; message: string; event: string; context: Record<string, unknown> }
/** 原生显卡帧通道（preload 交来的端口）。不进入渲染队列；渲染器经它读取原生解码帧，诊断只供真实性测试。 */
export type NativeFramesRequest =
  | { kind: 'nativeFrames.attach'; port: MessagePort }
  | { kind: 'nativeFrames.diagnose'; id: number; request: NativeFrameDiagnosticsRequest }
export type NativeFramesResponse = { id: number; nativeFrames?: NativeFrameDiagnosticsResult; error?: string }
let timing: VideoEditTimingContext | undefined
const timedStages = new Set<string>()
const timingEvent = (stage: string, durationMs?: number): void => {
  if (!timing || timedStages.has(stage)) return
  timedStages.add(stage)
  const context = { ...timing, elapsedMs: performance.timeOrigin + performance.now() - timing.startedAt, durationMs }
  const event = `video_edit.render.${stage}`
  performance.mark(event, { detail: context }); performance.clearMarks(event)
  log('info', '剪辑 Worker 阶段计时', event, context)
}
let renderer: VideoEditRenderer | undefined
let fonts: LoadedFontFaces | undefined
let direct = false
let revision = 0
let queue = Promise.resolve()
let nativeFrames: VideoEditNativeFrameReceiver | undefined
let nativeDiagnostics: NativeFrameDiagnostics | undefined
let nativeBackend: VideoEditNativeFrames | undefined
let router: VideoEditFrameRouter | undefined
let preopened: Array<() => void> = []
let preopenTimer: ReturnType<typeof setTimeout> | undefined
function releasePreopened(): void { clearTimeout(preopenTimer); for (const release of preopened) release(); preopened = [] }
function preopenMedia(request: Extract<RenderRequest, { kind: 'preopen' }>): void {
  releasePreopened()
  if (!nativeBackend) return
  if (request.timing) { timing = request.timing; timedStages.clear() }
  timingEvent('native.preopen.start')
  for (const media of request.media.slice(0, 2)) {
    const path = request.localPaths[media.path]
    if (!path) continue
    localPaths.set(media.path, path)
    try {
      const reservation = nativeBackend.preopen(media)
      preopened.push(reservation.release)
      const started = performance.now()
      void reservation.ready.then(() => { if (timing?.startedAt === request.timing?.startedAt) timingEvent('native.preopen.ready', performance.now() - started) }).catch(error => log('info', '序列预打开失败，正式取帧时重试', 'video_edit.render.preopen.failed', { sequenceId: request.timing?.sequenceId, reason: String(error) }))
    } catch (error) { log('info', '序列预打开不可用，正式取帧时重试', 'video_edit.render.preopen.failed', { reason: String(error) }) }
  }
  preopenTimer = setTimeout(releasePreopened, 2000)
}
let effectWarnings = new Set<string>()
const proxies = new Map<string, VideoProxyResult>()
function setProxies(values: Record<string, VideoProxyResult> | undefined): void { proxies.clear(); for (const [id, result] of Object.entries(values ?? {})) proxies.set(id, result) }
const localPaths = new Map<string, string>()
function setLocalPaths(paths: Record<string, string> | undefined): void { if (!paths) return; localPaths.clear(); for (const [url, path] of Object.entries(paths)) localPaths.set(url, path) }
const log = (level: RenderLogMessage['level'], message: string, event: string, context: Record<string, unknown>): void => { self.postMessage({ kind: 'log', level, message, event, context } satisfies RenderLogMessage) }
setVideoEditMaskTimingObserver(context => log('debug', '遮罩栅格化', 'video_edit.mask.raster.completed', context))
/** The renderer's decoding: the browser backend, plus native decoding when the frame channel is attached. */
function frameBackend(decode: RenderDecodeOptions | undefined): VideoEditProxyFrames {
  setProxies(decode?.proxies)
  setLocalPaths(decode?.localPaths)
  const channel = decode?.nativeAvailable && decode.forced !== 'browser' ? nativeFrames : undefined
  // Runtime native failures are recovered per read by the router (task 3.1).
  nativeBackend = channel ? new VideoEditNativeFrames({ channel, localPath: media => localPaths.get(media.path) }) : undefined
  router = new VideoEditFrameRouter(new VideoEditBrowserFrames(), nativeBackend, { nativeAvailable: !!nativeBackend, ...(decode?.forced ? { forced: decode.forced } : {}) }, log)
  return new VideoEditProxyFrames(router, proxies)
}
/** Releases the renderer, then the native sessions it closed, then the frame channel (frames return before it closes). */
async function disposeRenderer(): Promise<void> {
  releasePreopened()
  await renderer?.dispose()
  await nativeBackend?.settled(); router?.dispose()
  nativeBackend = undefined; router = undefined
}
function handleNativeFrames(request: NativeFramesRequest): void {
  if (request.kind === 'nativeFrames.attach') { void nativeFrames?.dispose(); nativeFrames = new VideoEditNativeFrameReceiver(request.port, undefined, (stage, durationMs) => timingEvent(`native.${stage}`, durationMs)); nativeDiagnostics = undefined; return }
  const receiver = nativeFrames
  if (!receiver) { self.postMessage({ id: request.id, error: '原生帧通道尚未接入。' } satisfies NativeFramesResponse); return }
  // 渲染 Worker 按 IIFE 打包，不能按需拆分加载；诊断模块很小且只在收到诊断消息时实例化。
  nativeDiagnostics ??= new NativeFrameDiagnostics(receiver)
  void nativeDiagnostics.handle(request.request).then(
    result => self.postMessage({ id: request.id, nativeFrames: result } satisfies NativeFramesResponse),
    error => self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies NativeFramesResponse))
}
const contentWarmup = new VideoEditContentWarmup(
  work => { queue = queue.then(work) },
  async (frame, current) => { await renderer?.prepareContent(frame, current) },
  (document, error) => log(error ? 'debug' : 'info', error ? '内容预热未完成，正式渲染按需准备' : '内容预热完成', error ? 'video_edit.content.warm.failed' : 'video_edit.content.warm.completed', { sequenceId: document.id, revision: document.revision, ...(error ? { reason: String(error) } : {}) }),
)
function warmContent(document: VideoEditComposition): void {
  if (document.clips.some(clip => clip.kind === 'code' || clip.effects?.some(effect => effect.code))) log('debug', '内容预热开始', 'video_edit.content.warm.start', { sequenceId: document.id, revision: document.revision })
  contentWarmup.replace(document)
}
const sharedCompilation = new VideoEditSharedCompilation(message => self.postMessage(message))
setVideoEditCodeCompilerWorkerFactory(() => sharedCompilation.worker())
self.onmessage = (event: MessageEvent<RenderRequest | NativeFramesRequest | SharedCompilationResponse>) => {
  if (event.data.kind === 'code.compiled') { sharedCompilation.receive(event.data); return }
  if (event.data.kind === 'nativeFrames.attach' || event.data.kind === 'nativeFrames.diagnose') { handleNativeFrames(event.data); return }
  const request = event.data
  const receivedAt = performance.now()
  if (request.kind === 'init') enableVideoEditFrameTrace(request.traceFrames === true)
  if (['init', 'update', 'replaceContent', 'parameters', 'dispose', 'fonts'].includes(request.kind)) contentWarmup.cancel()
  if (request.kind === 'render') contentWarmup.defer()
  if (request.kind === 'preopen') { preopenMedia(request); return }
  if (request.kind === 'tracks') { setVideoEditTrackResults(request.tracks); renderer?.cancelPresentation(); return }
  if (request.kind === 'regions') { setVideoEditSmartRegionSegments(request.regions); renderer?.cancelPresentation(); return }
  if (request.kind === 'invalidate') { if (revision !== request.revision) { contentWarmup.cancel(); revision = request.revision; renderer?.cancelPresentation() } return }
  if (request.kind === 'dispose') { revision = Number.MAX_SAFE_INTEGER; renderer?.cancelPresentation() }
  if (request.kind === 'init' || request.kind === 'update' || request.kind === 'replaceContent') { timing = 'timing' in request ? request.timing : undefined; timedStages.clear(); timingEvent(`worker.${request.kind}`); receiveCodeSourceTexts(request.codeSources) }
  if (request.kind === 'init' || request.kind === 'replaceContent') revision = request.document.revision
  if (request.kind === 'update') revision = Math.max(revision, request.document.revision)
  if (request.kind === 'parameters') revision = Math.max(revision, request.update.revision)
  queue = queue.then(async () => {
    try {
      if (request.kind === 'dispose') {
        fonts?.dispose(); fonts = undefined
        await disposeRenderer(); const codeResources = renderer?.codeDiagnostics(); renderer = undefined
        // Every borrowed native frame goes back before the session may terminate this worker (record 002).
        await nativeFrames?.dispose(); nativeFrames = undefined; nativeDiagnostics = undefined
        self.postMessage({ id: request.id, codeResources } satisfies RenderResponse)
      } else if (request.kind === 'authorMetadata') {
        if (!renderer) throw new Error('剪辑渲染会话尚未初始化。')
        const authorMetadata = await renderer.readAuthorMetadata(request.url, request.locations)
        self.postMessage({ id: request.id, authorMetadata } satisfies RenderResponse)
      } else if (request.kind === 'authorFrame') {
        if (!renderer) throw new Error('剪辑渲染会话尚未初始化。')
        const result = await renderer.renderAuthorFrame(request.url, request.params, request.info, request.assets, request.options)
        self.postMessage({ id: request.id, bitmap: result.bitmap, gpuMs: result.elapsedMs, elements: result.elements } satisfies RenderResponse, { transfer: [result.bitmap] })
      } else if (request.kind === 'fonts') {
        const started = performance.now()
        if (request.fonts.length) {
          fonts ??= new LoadedFontFaces((self as unknown as { fonts: FontFaceSet }).fonts)
          fonts.retainIds(request.availableIds)
          for (const payload of request.fonts) await fonts.load(payload)
        }
        fonts?.retainIds(request.availableIds)
        if (request.reset) await renderer?.invalidateFontResources()
        recordVideoEditPreparation('fontLoad', performance.now() - started)
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'init') {
        await disposeRenderer(); renderer = new VideoEditRenderer(request.document, request.previewWidth, request.surface, request.cacheBudgetBytes, frameBackend(request.decode), undefined, [request.document.id], timingEvent); direct = !!request.surface
        if (direct) warmContent(request.document)
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'replaceContent') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        releasePreopened(); setProxies(undefined); setLocalPaths(request.localPaths)
        setVideoEditTrackResults({}); setVideoEditSmartRegionSegments({}); effectWarnings.clear()
        await renderer.replaceContent(request.document)
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'update') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        setProxies(request.proxies)
        setLocalPaths(request.localPaths)
        await renderer.updateDocument(request.document); if (direct) warmContent(request.document); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'parameters') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        renderer.updateParameters(request.update); if (direct) warmContent(renderer.document); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'render') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        const renderStarted = performance.now()
        traceVideoEditFrame('worker.queue', request.frame, receivedAt, renderStarted)
        let snapshot: Promise<ImageBitmap> | undefined
        // A canvas texture expires across asynchronous boundaries. Copy in the draw
        // submission, before awaiting GPU completion or tearing down a trial session.
        const needsPixels = !direct || !!request.readRgb
        const capture = request.history || needsPixels ? Object.assign((pixels: Promise<ImageBitmap>): void => {
          if (snapshot) void snapshot.then(bitmap => bitmap.close(), () => {})
          snapshot = pixels
          void snapshot.catch(() => {})
        }, { maxPixels: needsPixels ? Infinity : 1280 * 720 }) : undefined
        const result = await renderer.render(request.frame, request.sequential, request.scrubbing, () => renderer?.document.revision === revision, request.deadline, undefined, request.quality, capture).catch(error => { if (snapshot) void snapshot.then(bitmap => bitmap.close(), () => {}); throw error })
        const readCodePerformance = renderer.captureCodePerformance()
        traceVideoEditFrame('worker.render', request.frame, renderStarted)
        const finish = async (): Promise<void> => {
          const owned = new Set<ImageBitmap>()
          try {
          const start = performance.now()
          for (const message of result.effectErrors ?? []) if (!effectWarnings.has(message)) log('warn', message, 'video_edit.effect.skipped', { sequenceId: renderer?.document.id, frame: request.frame })
          effectWarnings = new Set(result.effectErrors)
          await result.completion
          traceVideoEditFrame('compositor.complete', request.frame, start)
          const transferStarted = performance.now()
          const pixels = snapshot ? await snapshot : undefined
          if (pixels) owned.add(pixels)
          if (result.presented && (needsPixels || request.history) && !pixels) throw new Error('剪辑渲染没有返回画面快照。')
          let history: ImageBitmap | undefined
          if (request.history && pixels && result.presented) {
            const ratio = Math.min(1, Math.sqrt(1280 * 720 / (pixels.width * pixels.height)))
            history = needsPixels ? await createImageBitmap(pixels, { resizeWidth: Math.max(1, Math.floor(pixels.width * ratio)), resizeHeight: Math.max(1, Math.floor(pixels.height * ratio)), resizeQuality: 'high' }) : pixels
            owned.add(history)
          }
          const rgb = request.readRgb && result.presented && pixels ? readVideoEditTrackingRgb(pixels, request.readRgb) : undefined
          const bitmap = rgb || direct || !result.presented ? undefined : pixels
          traceVideoEditFrame('bitmap.prepare', request.frame, transferStarted)
          const postedAt = performance.now()
          self.postMessage({ id: request.id, bitmap, history, rgb, effectErrors: result.effectErrors, sourceTimestamps: result.sourceTimestamps, blankPictures: result.blankPictures, singleFrameReads: result.singleFrameReads, cacheHits: result.cacheHits, cacheBytes: result.cacheBytes, presented: result.presented, decodeMs: result.decodeMs, gpuMs: result.gpuMs + performance.now() - start, codeResources: renderer?.codeDiagnostics(), codePerformance: readCodePerformance(), preparationStages: videoEditPreparationSnapshot() } satisfies RenderResponse, { transfer: [...(rgb ? [rgb.buffer as ArrayBuffer] : bitmap ? [bitmap] : []), ...(history ? [history] : [])] })
          if (bitmap) owned.delete(bitmap)
          traceVideoEditFrame('worker.post', request.frame, postedAt)
          if (history) owned.delete(history)
          } catch (error) {
            if (!owned.size && snapshot) void snapshot.then(bitmap => bitmap.close(), () => {})
            throw error
          } finally { owned.forEach(bitmap => bitmap.close()) }
        }
        // 拖动与正向播放：提交后先回执，下一帧不必等这一帧的 GPU 完成（节目监视器两帧流水）。
        if (direct && !request.history && (request.scrubbing || (request.sequential && request.deadline !== undefined))) {
          self.postMessage({ id: request.id, phase: 'submitted' } satisfies RenderResponse)
          void finish().catch(error => self.postMessage({ id: request.id, error: String(error) } satisfies RenderResponse))
        } else await finish()
      } else if (request.kind === 'prepareGpu') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        await renderer.prepareGpu(); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'arm') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        await renderer.armPlayback(request.frame); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'scale') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        renderer.setRenderDivisor(request.divisor); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'precision') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        const precision = await renderer.precisionDiagnostics(request.row)
        self.postMessage({ id: request.id, precision } satisfies RenderResponse, { transfer: precision.row ? [precision.row.buffer as ArrayBuffer] : [] })
      } else {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        const channels = await renderer.mixAudio(request.start, request.duration)
        self.postMessage({ id: request.id, channels } satisfies RenderResponse, { transfer: channels.map(channel => channel.buffer as ArrayBuffer) })
      }
    } catch (error) { self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies RenderResponse) }
  })
}

log('debug', '剪辑 Worker 模块已加载', 'video_edit.worker.loaded', { loadedAt: performance.timeOrigin + performance.now() })
