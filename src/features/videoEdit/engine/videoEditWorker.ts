import type { TextPreflightRequest } from './videoEditTextPreflight'
import { setVideoEditDenoiserWeights } from './videoEditDenoiserWeights'
import { readAuthorCandidateMetadata, releaseAuthorCandidate, closeAuthorCandidates } from './videoEditAuthorCandidates'
import { renewTextFontLease, acquireSharedTextFontLease, attachTextFontChannel, closeTextFontChannel, type TextFontChannelAttach } from './videoEditTextFontChannel'
import { videoEditRenderFailure, installVideoEditWorkerErrorReporting } from './videoEditGpuFailure'
import { setVideoEditGpuFaultObserver } from './videoEditGpuErrorScope'
import { VideoEditGpuFrameError } from './videoEditGpuFailure'
import { VideoEditCodeFingerprint } from './videoEditCodeFingerprint'
import { enableVideoEditFrameTrace, traceVideoEditFrame } from './videoEditFrameTrace'
import { VideoEditSharedCompilation, type SharedCompilationResponse } from './videoEditSharedCompilation'
import { installAuthorMetadataCache } from './videoEditAuthorMetadataCache'
import { installAuthorNativeModules } from './videoEditAuthorModules'
import { installAuthorTrustGate } from './videoEditAuthorTrust'
import { setVideoEditCodeCompilerWorkerFactory } from './videoEditCodeCompiler'
import { videoEditPreparationSnapshot, videoEditPreparationDelta, recordVideoEditPreparation, enableVideoEditRenderDiagnostics, videoEditRenderDiagnosticsEnabled, probeVideoEditTask, beginVideoEditGpuFrame, takeVideoEditGpuFrame, videoEditDeliveryStages, videoEditLagSummary } from './videoEditPreparationTiming'
import type { VideoEditTimingContext } from './videoEditFirstFrameTiming'
import type { EffectQuality } from '@/core/imaging/effects/descriptor'
import { VideoEditProxyFrames } from './videoEditProxyFrames'
import { videoEditDecodeSource, type VideoProxyResult } from '@/core/videoEdit/proxy'
import { VideoEditDecodeLookahead } from './videoEditDecodeLookahead'
import { VideoEditRenderer, type VideoEditPresentedSource, type VideoEditRenderPrecision } from './videoEditRenderer'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { VideoEditNativeFrameReceiver } from './videoEditNativeFrames'
import { installVideoEditWebChannel } from './videoEditWebInputs'
import { NativeFrameDiagnostics, type NativeFrameDiagnosticsRequest, type NativeFrameDiagnosticsResult } from './videoEditNativeFrameDiagnostics'
import { VideoEditBrowserFrames } from './videoEditBrowserFrames'
import { VideoEditNativeFrames } from './videoEditNativeFrameSource'
import { VideoEditFrameRouter, type VideoEditDecodeSettings } from './videoEditFrameRouter'
import { setVideoEditTrackResults, type VideoEditTrackResults } from './videoEditTrackResults'
import { setVideoEditSmartRegionSegments, type VideoEditSmartRegionSegments } from './videoEditSmartRegionMasks'
import { readVideoEditTrackingRgb } from './videoEditTrackingPixels'
import { setVideoEditMaskTimingObserver } from './videoEditEffectMasks'
import { LoadedFontFaces } from '@/platform/fontFaces'
import { receiveCodeSourceTexts, installCodeSourceReader } from '@/core/videoEdit/codeMaterial/sources'
import type { FontPayload } from '@/platform/fonts'
import type { VideoEditParameterUpdate } from './videoEditParameterUpdate'
import type { VideoEditDeviceMemory } from './videoEditGpuBudget'
import { VideoEditEncoderFailure, VideoEditFrameEncoder, type VideoEditEncodedChunk, type VideoEditEncodeGeometry, type VideoEditEncodePurpose, type VideoEditEncodeSample, type VideoEditEncoderFailureReason, type VideoEditFrameEncodeTiming } from './videoEditFrameEncoder'
import { VideoEditGridCells, type VideoEditGridSurfaces } from './videoEditMulticamGrid'

installVideoEditWorkerErrorReporting(self)
// 开发版：Vite 要求整页刷新时也会在 Worker 里调用 location.reload，而 Worker 的 location 没有这个方法，抛出的未捕获异常会中止渲染会话。
// 页面随即整页刷新、Worker 跟着被换掉，这里什么都不用做。
// 没有 location 的环境（单元测试里的模拟 Worker）用不到 Vite 客户端，不必补。
const workerLocation = (self as { location?: object }).location
if (import.meta.env.DEV && workerLocation && typeof (workerLocation as { reload?: unknown }).reload !== 'function') Object.defineProperty(Object.getPrototypeOf(workerLocation), 'reload', { configurable: true, value: () => {} })

/**
 * Decoding settings of one render session. `localPaths` maps each media item's fetchable URL (its path in the worker)
 * to the local file the native decoder reads.
 */
export interface RenderDecodeOptions extends VideoEditDecodeSettings { localPaths?: Record<string, string>; proxies?: Record<string, VideoProxyResult> }
export type RenderRequest = { id: number } & (
  { kind: 'prepareText'; requests: TextPreflightRequest[] } |
  { kind: 'fingerprint'; clipId: string; frame: number; endFrame: number; budgetMs: number; webContent: Record<string, string> } |
  { kind: 'stopPlayback'; frame: number } |
  { kind: 'fonts'; fonts: FontPayload[]; availableIds: string[]; reset: boolean; fixedTextFonts?: boolean } |
  { kind: 'init'; cacheWebOutput?: boolean; traceFrames?: boolean; /** 渲染诊断（GPU 时间戳与事件循环迟滞探针），只供基准与排障。 */ diagnostics?: boolean; timing?: VideoEditTimingContext; document: VideoEditComposition; codeSources?: Record<string, string>; previewWidth?: number; surface?: OffscreenCanvas; /** 多机位网格：合成画面切给各格子的画布，与 `surface` 二选一。 */ gridCells?: VideoEditGridSurfaces; cacheBudgetBytes?: number; device?: VideoEditDeviceMemory; decode?: RenderDecodeOptions } | { kind: 'update'; timing?: VideoEditTimingContext; document: VideoEditComposition; codeSources?: Record<string, string>; localPaths?: Record<string, string>; proxies?: Record<string, VideoProxyResult> }
  | { kind: 'replaceContent'; document: VideoEditComposition; codeSources?: Record<string, string>; localPaths: Record<string, string> }
  | { kind: 'invalidate'; revision: number }
  | { kind: 'parameters'; update: VideoEditParameterUpdate }
  /** Preview playback resolution (task 4.9): the next renders draw at 1/divisor of the sequence size. */
  | { kind: 'scale'; divisor: number }
  | { kind: 'webDisplayScale'; scale: number }
  | { kind: 'spaceDisplay'; display: import('@/core/videoEdit/spaceDisplay').VideoEditSpaceRenderDisplay }
  | { kind: 'denoiser'; url: string }
  | { kind: 'outputScale'; scale: number; renderAtOutputResolution: boolean }
  | { kind: 'arm'; frame: number; precision?: VideoEditRenderPrecision }
  | { kind: 'prepareGpu' }
  | { kind: 'authorMetadata'; url: string; locations?: import('./videoEditAuthorBundle').AuthorSourceLocations; apiVersion?: number; bundle?: import('@/core/videoEdit/codeAuthorProgram').CodeAuthorBundle }
  | { kind: 'authorRelease'; url: string }
  | { kind: 'authorFrame'; assets?: Record<string, ImageBitmap>; url: string; params: import('./videoEditAuthorModule').AuthorParameters; info: import('./videoEditAuthorModule').AuthorFrameInfo; options?: Parameters<VideoEditRenderer['renderAuthorFrame']>[4] }
  | { kind: 'preopen'; document: VideoEditComposition; frame: number; localPaths: Record<string, string>; timing?: VideoEditTimingContext }
  /** 已分析好的智能区域段落（4.7d），按素材地址与分析种类；不进渲染队列，下一次渲染即生效。 */
  | { kind: 'tracks'; tracks: VideoEditTrackResults }
  /** 播放计划只解参考帧的素材（多机位格子带不动时）；不进渲染队列，下一个播放计划即生效。 */
  | { kind: 'referenceOnly'; mediaIds: string[] }
  | { kind: 'regions'; regions: VideoEditSmartRegionSegments }
  /** 已就绪的预渲染窗口与它们的本地文件；不进渲染队列，下一次正向播放的渲染即使用。 */
  | { kind: 'renderCache'; windows: import('./videoEditRenderer').VideoEditRenderCacheWindow[]; localPaths: Record<string, string> }
  | { kind: 'dispose' }
  | { kind: 'hoverFrame'; document: VideoEditComposition; frame: number; allowRender: boolean }
  | { kind: 'cancelHoverFrame' }
  /** `sentAt`：诊断时主线程发出请求的绝对时间（timeOrigin + now），用来算投递延迟。 */
  /** `encode`：画面不交回界面线程，在 Worker 里直接送进这条编码流（导出与预渲染）。 */
  | { kind: 'render'; precision?: VideoEditRenderPrecision; requireLive?: boolean; sentAt?: number; observeElements?: boolean; quality?: EffectQuality; frame: number; sequential: boolean; scrubbing?: import('./videoEditRenderer').VideoEditScrubMode; deadline?: number; readRgb?: { width: number; height: number }; history?: boolean; encode?: { stream: number } & VideoEditEncodeSample }
  /** 在 Worker 里打开一条视频编码流；编码结果经 `encoder.chunk` 消息交回。 */
  | { kind: 'encoderOpen'; stream: number; purpose: VideoEditEncodePurpose; config: VideoEncoderConfig; output?: VideoEditEncodeGeometry }
  /** 等这条编码流交出全部结果后关闭它。 */
  | { kind: 'encoderFlush'; stream: number }
  /** 立即停止这条编码流（取消、失败）；不进渲染队列。 */
  | { kind: 'encoderClose'; stream: number }
  | { kind: 'audio'; start: number; duration: number; retainIdle?: boolean }
  /** Acceptance probes only (task 2.7): high-precision counters and one row of the last high-precision composition. */
  | { kind: 'precision'; row?: number })
export type RenderResponse = { gpuFrame?: import('./videoEditGpuFailure').VideoEditGpuFrameFacts; provenance?: import('@/platform/contracts/videoFrames').WebSourceProvenance; fingerprints?: Array<[number, import('@/core/videoEdit/renderFingerprint').VideoEditFrameFingerprint]>; hoverBytes?: Uint8Array; /** A program scrub frame answered without rendering: a newer frame request had already arrived. */ skipped?: boolean; refining?: boolean; /** 渲染显示方式下路径追踪的进度（0–1）。 */ spaceProgress?: number; renderCached?: boolean; renderElapsedMs?: number; renderStages?: Record<string, number>; approximate?: boolean; gpuDeviceLost?: string; authorElements?: import('@/core/videoEdit/codeAuthorProgram').CodeAuthorFrameObservation; authorMetadata?: import('./videoEditAuthorParameters').AuthorEffectMetadata; elements?: import('./videoEditAuthorElements').AuthorElementObservation[]; preparationStages?: ReturnType<typeof videoEditPreparationSnapshot>; codePerformance?: import('@/core/videoEdit/codeMaterial/performance').CodeFramePerformance[]; id: number; phase?: 'submitted' | 'presented' | 'refined'; frame?: number; sequenceId?: string; revision?: number; presentedSource?: VideoEditPresentedSource; error?: string; contentTrust?: import('@/core/contentTrust').ContentTrustFailure; /** 效果错误，后接 sceneIssues（节目监视器按这一项提示用户）。 */ effectErrors?: string[]; /** 片子数据里会让画面缺内容的问题，也已在 effectErrors 里：试渲染等据此不把它们当成失败。 */ sceneIssues?: string[]; bitmap?: ImageBitmap; history?: ImageBitmap; rgb?: Uint8Array; sourceTimestamps?: number[]; blankPictures?: number; singleFrameReads?: number; channels?: Float32Array[]; cacheHits?: number; cacheBytes?: number; presented?: boolean; decodeMs?: number; gpuMs?: number; codeResources?: ReturnType<VideoEditRenderer['codeDiagnostics']>; precision?: Awaited<ReturnType<VideoEditRenderer['precisionDiagnostics']>>; /** 送进编码流的这一帧在 Worker 里的耗时。 */ encoded?: VideoEditFrameEncodeTiming; /** 失败出在视频编码器（原因与诊断细节），界面线程据此给出编码相关的提示。 */ encoderFailure?: { reason: VideoEditEncoderFailureReason; detail: string } }
/** Structured log entries the worker cannot write itself; the render session forwards them to the application log. */
export interface RenderLogMessage { kind: 'log'; level: 'debug' | 'info' | 'warn'; message: string; event: string; context: Record<string, unknown> }
/** 编码流交出的一份编码结果。 */
export interface VideoEditEncodedChunkMessage { kind: 'encoder.chunk'; stream: number; chunk: VideoEditEncodedChunk }
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
let fingerprints: VideoEditCodeFingerprint | undefined
let textController = new AbortController()
let textQueue: Promise<unknown> = Promise.resolve()
let fonts: LoadedFontFaces | undefined
let direct = false
/** 多机位网格会话的格子画布（见 `VideoEditGridCells`）。 */
let gridCells: VideoEditGridCells | undefined
let revision = 0
let queue = Promise.resolve()
let nativeFrames: VideoEditNativeFrameReceiver | undefined
let nativeDiagnostics: NativeFrameDiagnostics | undefined
let nativeBackend: VideoEditNativeFrames | undefined
let router: VideoEditFrameRouter | undefined
let decodeLookahead: VideoEditDecodeLookahead | undefined
function releasePreopened(): void { decodeLookahead?.cancel() }
function preopenMedia(request: Extract<RenderRequest, { kind: 'preopen' }>): void {
  releasePreopened()
  if (!decodeLookahead) return
  if (request.timing) { timing = request.timing; timedStages.clear() }
  for (const [url, path] of Object.entries(request.localPaths)) localPaths.set(url, path)
  decodeLookahead.beforeFrame(request.document, request.frame, false)
  decodeLookahead.update(request.document, request.frame, false, [])
}
let effectWarnings = new Set<string>()
// 排队或正在准备的前台帧优先；GPU 呈现回执后仅在 Worker 队列空档发起准备。
let foregroundFrames = 0
let hoverRequest: AbortController | undefined
const authorRequests = new Map<string, AbortController>()
let hoverEpoch = 0
let latestRender: { frame: number; sequential: boolean } | undefined
/**
 * Paused program frames (non-sequential, no pixels read back) queued and not started yet, by request id: a newer frame
 * request answers them at once as skipped, so the program's in-flight budget frees up and the queue keeps only the
 * newest position.
 */
const queuedFrames = new Map<number, () => void>()
/** 像素回读和完整选帧独占提交前的画布，缓存不能抢占它的快照。 */
let pixelRendering = false
let backgroundElements: number | undefined
let backgroundRenderId: number | undefined
let latestForegroundRequest: RenderRequest | undefined
/**
 * Counts `stopPlayback` messages, applied the moment one arrives (outside the queue). A playback frame (one with a
 * presentation deadline) received before the latest stop and not on screen yet never presents: queued ones are answered
 * skipped without rendering and the one being prepared gives up at its next presentation check, so pausing never shows
 * the frames the program had queued ahead of the pause.
 */
let playbackEpoch = 0
let summaryAt = performance.now()
let lookaheadStats = { preopened: 0, hits: 0, misses: 0, budgetSkipped: 0, foregroundSkipped: 0, scans: 0, scanMs: 0, maxScanMs: 0 }
let lookaheadMisses: Array<Record<string, unknown>> = []
function lookaheadSummary(reason: string): void {
  const content = renderer?.lookaheadMetrics
  log('info', '播放前瞻汇总', 'video_edit.decode.lookahead.summary', { sequenceId: renderer?.document.id, reason, ...lookaheadStats, missesDetail: lookaheadMisses, ...content, budgetSkipped: lookaheadStats.budgetSkipped + (content?.budgetSkipped ?? 0) })
  lookaheadStats = { preopened: 0, hits: 0, misses: 0, budgetSkipped: 0, foregroundSkipped: 0, scans: 0, scanMs: 0, maxScanMs: 0 }; lookaheadMisses = []; summaryAt = performance.now()
  if (content) for (const key of Object.keys(content) as Array<keyof typeof content>) content[key] = 0
}
/** 打开着的编码流（导出与预渲染各开一条），按界面线程分配的编号。 */
const encoders = new Map<number, VideoEditFrameEncoder>()
function closeEncoder(stream: number): void { encoders.get(stream)?.close(); encoders.delete(stream) }
const proxies = new Map<string, VideoProxyResult>()
function setProxies(values: Record<string, VideoProxyResult> | undefined): void { proxies.clear(); for (const [id, result] of Object.entries(values ?? {})) proxies.set(id, result) }
const localPaths = new Map<string, string>()
const renderCachePaths = new Map<string, string>()
let renderCacheWindows: import('./videoEditRenderer').VideoEditRenderCacheWindow[] = []
/** 播放时只解参考帧的素材 ID（`referenceOnly` 消息）：只作用于本会话的播放计划，单帧读取与顺序读取照常逐帧。 */
const referenceOnlyMedia = new Set<string>()
function setLocalPaths(paths: Record<string, string> | undefined): void { if (!paths) return; localPaths.clear(); for (const [url, path] of Object.entries(paths)) localPaths.set(url, path) }
const log = (level: RenderLogMessage['level'], message: string, event: string, context: Record<string, unknown>): void => {
  if (event === 'video_edit.decode.lookahead.scan') { lookaheadStats.scans++; const ms = Number(context.durationMs); lookaheadStats.scanMs += ms; lookaheadStats.maxScanMs = Math.max(lookaheadStats.maxScanMs, ms) }
  if (event === 'video_edit.decode.preopen.opened') lookaheadStats.preopened++
  if (event === 'video_edit.decode.preopen.hit') lookaheadStats.hits++
  if (event === 'video_edit.decode.preopen.miss') { lookaheadStats.misses++; if (lookaheadMisses.length < 64) lookaheadMisses.push({ ...context, clipIds: decodeLookahead?.clipIdsForMedia(String(context.mediaId)) }) }
  if (event === 'video_edit.decode.preopen.skipped') { if (context.reason === 'budget') lookaheadStats.budgetSkipped++; else lookaheadStats.foregroundSkipped++ }
  self.postMessage({ kind: 'log', level, message, event, context } satisfies RenderLogMessage) }
setVideoEditMaskTimingObserver(context => log('debug', '遮罩栅格化', 'video_edit.mask.raster.completed', context))
setVideoEditGpuFaultObserver((event, message, context) => log('warn', 'GPU 执行失败', event, { message, ...context }))
/** The renderer's decoding: the browser backend, plus native decoding when the frame channel is attached. */
function frameBackend(decode: RenderDecodeOptions | undefined): VideoEditProxyFrames {
  setProxies(decode?.proxies)
  setLocalPaths(decode?.localPaths)
  const channel = decode?.nativeAvailable && decode.forced !== 'browser' ? nativeFrames : undefined
  // Runtime native failures are recovered per read by the router (task 3.1).
  nativeBackend = channel ? new VideoEditNativeFrames({ channel, localPath: media => localPaths.get(media.path) ?? renderCachePaths.get(media.path), retainIdle: direct, referenceOnly: media => referenceOnlyMedia.has(media.id), log }) : undefined
  decodeLookahead = direct ? new VideoEditDecodeLookahead(nativeBackend, media => videoEditDecodeSource(media, proxies.get(media.id), true, 'playback'), { idle: () => foregroundFrames === 0 || renderer?.waitingForPresentation === true, prepare: (target, signal) => renderer?.prepareLookahead(target, signal) ?? Promise.resolve(false), retain: targets => renderer?.retainLookahead(targets), declarations: instance => renderer?.codeDeclarations(instance) }) : undefined
  router = new VideoEditFrameRouter(new VideoEditBrowserFrames(), nativeBackend, { nativeAvailable: !!nativeBackend, ...(decode?.forced ? { forced: decode.forced } : {}) }, log)
  return new VideoEditProxyFrames(router, proxies)
}
/** Releases the renderer, then the native sessions it closed, then the frame channel (frames return before it closes). */
async function disposeRenderer(): Promise<void> {
  releasePreopened()
  await fingerprints?.dispose(); fingerprints = undefined
  await renderer?.dispose()
  await closeAuthorCandidates()
  renewTextFontLease()
  await nativeBackend?.disposeIdle()
  await nativeBackend?.settled(); router?.dispose()
  nativeBackend = undefined; router = undefined; decodeLookahead = undefined
}
let nativePort: MessagePort | undefined
const labeledPorts = new WeakSet<MessagePort>()
/** 诊断时给原生帧端口的消息处理打标签（端口可能在初始化前后接入，两处都调用）。 */
function labelNativePort(): void {
  const port = nativePort, handler = port?.onmessage
  if (!port || !handler || labeledPorts.has(port) || !videoEditRenderDiagnosticsEnabled()) return
  labeledPorts.add(port)
  port.onmessage = event => probeVideoEditTask('nativeFrames.message', () => handler.call(port, event))
}
function handleNativeFrames(request: NativeFramesRequest): void {
  if (request.kind === 'nativeFrames.attach') { void nativeFrames?.dispose(); nativeFrames = new VideoEditNativeFrameReceiver(request.port, undefined, (stage, durationMs) => timingEvent(`native.${stage}`, durationMs)); nativeDiagnostics = undefined; nativePort = request.port; labelNativePort(); return }
  const receiver = nativeFrames
  if (!receiver) { self.postMessage({ id: request.id, error: '原生帧通道尚未接入。' } satisfies NativeFramesResponse); return }
  // 渲染 Worker 按 IIFE 打包，不能按需拆分加载；诊断模块很小且只在收到诊断消息时实例化。
  nativeDiagnostics ??= new NativeFrameDiagnostics(receiver)
  void nativeDiagnostics.handle(request.request).then(
    result => self.postMessage({ id: request.id, nativeFrames: result } satisfies NativeFramesResponse),
    error => self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies NativeFramesResponse))
}
// 只按当前帧和播放头前三秒预热，不在初始化时扫描整条序列。
const sharedCompilation = new VideoEditSharedCompilation(message => self.postMessage(message))
installAuthorTrustGate(request => sharedCompilation.trust(request))
setVideoEditCodeCompilerWorkerFactory(() => sharedCompilation.worker())
installCodeSourceReader(file => sharedCompilation.read(file))
installAuthorMetadataCache({ read: key => sharedCompilation.metadata(key), write: async (key, metadata) => { await sharedCompilation.metadata(key, metadata) } })
installAuthorNativeModules(files => sharedCompilation.modules(files))
installVideoEditWebChannel(() => nativeFrames)
self.onmessage = (event: MessageEvent<RenderRequest | NativeFramesRequest | SharedCompilationResponse | TextFontChannelAttach>) => {
  if (videoEditRenderDiagnosticsEnabled()) probeVideoEditTask(`message.${event.data.kind}`, () => receive(event))
  else receive(event)
}
/** 要像素的请求按失败处理，不交坏画面；不要像素的请求画面已在屏幕上，照常显示并提示。 */
async function frameGpuFault(completion: Promise<void>, needsPixels: boolean): Promise<VideoEditGpuFrameError | undefined> {
  try { await completion; return undefined }
  catch (error) {
    if (needsPixels || !(error instanceof VideoEditGpuFrameError)) throw error
    return error
  }
}
function receive(event: MessageEvent<RenderRequest | NativeFramesRequest | SharedCompilationResponse | TextFontChannelAttach>): void {
  if (event.data.kind === 'code.trustResult' || event.data.kind === 'code.compiled' || event.data.kind === 'code.source' || event.data.kind === 'code.metadataResult' || event.data.kind === 'code.moduleUrls') { sharedCompilation.receive(event.data); return }
  if (event.data.kind === 'textFonts.attach') { attachTextFontChannel(event.data.port); return }
  if (event.data.kind === 'nativeFrames.attach' || event.data.kind === 'nativeFrames.diagnose') { handleNativeFrames(event.data); return }
  const request = event.data
  // 取消与失败时立即停止编码：排在队列里的帧随后发现编码流已关，不合成。
  if (request.kind === 'encoderClose') { closeEncoder(request.stream); return }
  if (request.kind === 'dispose') for (const stream of [...encoders.keys()]) closeEncoder(stream)
  if (request.kind === 'prepareText') {
    const controller = textController
    textQueue = textQueue.catch(() => undefined).then(async () => {
      for (const item of request.requests) {
        controller.signal.throwIfAborted()
        const lease = await acquireSharedTextFontLease(item.version)
        try { await lease.fonts.prepare(item.declaration, controller.signal) }
        catch (error) {
          if (!item.optional || controller.signal.aborted) throw error
          log('debug', '滤镜字体准备失败，交由正式渲染报告', 'video_edit.text_fonts.effect_skipped', { error: String(error) })
        }
        finally { lease.release() }
      }
      self.postMessage({ id: request.id } satisfies RenderResponse)
    }).catch(error => self.postMessage({ id: request.id, ...(controller.signal.aborted ? { skipped: true } : videoEditRenderFailure(error)) } satisfies RenderResponse))
    return
  }
  if (request.kind === 'authorFrame' || request.kind === 'authorRelease') authorRequests.get(request.url)?.abort()
  if (request.kind === 'init' || request.kind === 'dispose') { for (const controller of authorRequests.values()) controller.abort(); authorRequests.clear() }
  const authorController = request.kind === 'authorFrame' ? new AbortController() : undefined
  if (request.kind === 'authorFrame') authorRequests.set(request.url, authorController!)
  if (request.kind === 'dispose') textController.abort()
  if (request.kind === 'dispose') closeTextFontChannel()
  // 字体、代理切换和起播也要先让后台现场画面退场，不能等 render 排到队首才取消。
  if (request.kind !== 'hoverFrame' && request.kind !== 'cancelHoverFrame' && request.kind !== 'renderCache') {
    latestForegroundRequest = request
    if (backgroundRenderId !== undefined) renderer?.abandonPausedFrame()
  }
  if (request.kind === 'cancelHoverFrame') { hoverEpoch++; hoverRequest?.abort(); return }
  // 前台请求到达即取消后台解码，不等它排到队首。
  if (request.kind !== 'hoverFrame' && request.kind !== 'renderCache') { hoverEpoch++; hoverRequest?.abort() }
  const requestedHoverEpoch = hoverEpoch
  const receivedAt = performance.now()
  let foregroundPending = request.kind === 'render'
  const releaseForeground = (): void => { if (foregroundPending) { foregroundPending = false; foregroundFrames-- } }
  if (['init', 'update', 'replaceContent', 'parameters', 'dispose', 'invalidate', 'stopPlayback'].includes(request.kind)) releasePreopened()
  if (request.kind === 'stopPlayback') playbackEpoch++
  // A playback frame that a later stop cancelled (see `playbackEpoch`).
  const epoch = playbackEpoch
  const cancelledByStop = (): boolean => request.kind === 'render' && request.deadline !== undefined && epoch !== playbackEpoch
  if (request.kind === 'render') { latestRender = request; foregroundFrames++; if (renderer) decodeLookahead?.beforeFrame(renderer.document, request.frame, request.sequential === true) }
  const presentationOrder = request.kind === 'render' ? renderer?.reservePresentation() : undefined
  let skipped = false
  if (request.kind === 'render' && !request.sequential) {
    // 节目暂停时（拖动、跳转、逐帧）排队还没开始的旧画面请求当场答复 skipped（节目照常等这一帧），Worker 一空下来就画最新的
    // 位置，不必等主线程收到回执再发下一帧（主线程忙于指针事件与界面更新，回执要晚 7–20ms 才轮到处理）；连按方向键或连续点击
    // 也不会把一串过时的精确帧（长 GOP 每帧可达一秒）排在后面，节目的在途名额也随即空出来。
    for (const [id, skip] of queuedFrames) if (id < request.id) { queuedFrames.delete(id); skip() }
    if (!request.history && !request.readRgb) queuedFrames.set(request.id, () => { skipped = true; releaseForeground(); self.postMessage({ id: request.id, presented: false, skipped: true } satisfies RenderResponse) })
    // 已在准备的暂停精确画面（长 GOP 可达一秒）也让给这一帧：渲染器放弃它（答复 skipped），解码停在已解到的位置，
    // 这一帧不排在一幅没人要的画面后面。播放帧（有呈现时刻）与要回读像素的帧不放弃任何帧。
    if (request.deadline === undefined && !request.history && !request.readRgb) renderer?.supersedePausedFrame(request.frame, !request.requireLive && (!!request.scrubbing || !!renderer?.hasPrerenderedFrame(request.frame, request.precision)), request.precision)
  }
  if (request.kind === 'init') { enableVideoEditFrameTrace(request.traceFrames === true); enableVideoEditRenderDiagnostics(request.diagnostics === true); labelNativePort() }

  if (request.kind === 'preopen') { preopenMedia(request); return }
  // 现场合成可能等网页或解码器收尾；缓存使用独立读取器和绘制锁，不能排在它后面。
  let outsidePreview: Promise<boolean> | undefined
  if (request.kind === 'render' && !pixelRendering && renderer && direct && !request.sequential && request.deadline === undefined && !request.history && !request.readRgb && !request.requireLive && renderer.hasPrerenderedFrame(request.frame, request.precision)) {
    const current = renderer
    // 已开始的缓存读取占着自己的在途名额；后来的指针请求不能跳过它的回执或作废尚有上屏机会的画面。
    queuedFrames.delete(request.id)
    const preview = current.presentPrerenderedFrame(request.frame, () => renderer === current && current.document.revision === revision && !pixelRendering && (!!request.scrubbing || latestRender === request), !request.scrubbing, presentationOrder, request.precision)
    outsidePreview = preview.then(async shown => {
      if (!shown || skipped) return false
      // 缓存是否画出只决定提前回执，不能丢掉仍有人要的松手现场帧。
      if (!shown.presented && latestRender === request) return false
      queuedFrames.delete(request.id); releaseForeground()
      const completingAt = performance.now()
      // 这条路径的请求不取像素：画面已在屏幕上，照常回执并提示。
      const gpuFault = await frameGpuFault(shown.completion, false)
      skipped = !shown.presented
      self.postMessage({ id: request.id, presented: shown.presented, ...(gpuFault ? { effectErrors: [gpuFault.message], gpuFrame: gpuFault.facts } : {}), ...(!shown.presented ? { skipped: true } : {}), provenance: shown.provenance, presentedSource: shown.presentedSource, refining: !request.scrubbing, renderCached: true, renderElapsedMs: performance.now() - receivedAt, ...(videoEditRenderDiagnosticsEnabled() ? { preparationStages: videoEditPreparationSnapshot() } : {}), renderStages: { ...shown.renderStages, queue: 0, presentComplete: performance.now() - completingAt, ...(videoEditRenderDiagnosticsEnabled() && request.sentAt !== undefined ? videoEditDeliveryStages(request.sentAt, performance.timeOrigin + receivedAt) : {}) }, sourceTimestamps: [], blankPictures: 0, singleFrameReads: 0, cacheHits: shown.cacheHits, cacheBytes: shown.cacheBytes, decodeMs: shown.decodeMs, gpuMs: shown.gpuMs } satisfies RenderResponse)
      return true
    }).catch(error => { skipped = true; queuedFrames.delete(request.id); releaseForeground(); self.postMessage({ id: request.id, ...videoEditRenderFailure(error) } satisfies RenderResponse); return true })
    // 缓存成功即完成请求；暂停帧的现场合成在队列内继续，后续缓存请求仍可在队列外上屏。
  }
  if (request.kind === 'tracks') { setVideoEditTrackResults(request.tracks); renderer?.cancelPresentation(); return }
  if (request.kind === 'referenceOnly') { referenceOnlyMedia.clear(); for (const id of request.mediaIds) referenceOnlyMedia.add(id); return }
  if (request.kind === 'regions') { setVideoEditSmartRegionSegments(request.regions); renderer?.cancelPresentation(); return }
  if (request.kind === 'renderCache') { renderCachePaths.clear(); for (const [url, path] of Object.entries(request.localPaths)) renderCachePaths.set(url, path); renderCacheWindows = request.windows; renderer?.setRenderCache(renderCacheWindows); if (renderer) decodeLookahead?.windowsChanged(renderer.document, renderCacheWindows); else releasePreopened(); return }
  if (request.kind === 'invalidate') { if (revision !== request.revision) { revision = request.revision; renderer?.cancelPresentation() } return }
  // 关闭会话时在准备的暂停精确画面已经没人要：当场放弃，关闭不用排在它的解码后面。
  if (request.kind === 'dispose') { revision = Number.MAX_SAFE_INTEGER; renderer?.cancelPresentation(); renderer?.abandonPausedFrame() }
  if (request.kind === 'init' || request.kind === 'update' || request.kind === 'replaceContent') { timing = 'timing' in request ? request.timing : undefined; timedStages.clear(); timingEvent(`worker.${request.kind}`); receiveCodeSourceTexts(request.codeSources) }
  if (request.kind === 'init' || request.kind === 'replaceContent') revision = request.document.revision
  if (request.kind === 'update') revision = Math.max(revision, request.document.revision)
  if (request.kind === 'parameters') revision = Math.max(revision, request.update.revision)
  let backgroundRender = false
  let backgroundComposition: VideoEditComposition | undefined
  queue = queue.then(async () => {
    try {
      // 快速拖动时一幅实时画面可能在请求交回后继续在后台准备（渲染器先画了常驻关键帧）：改动渲染器的请求等它收尾。
      if (request.kind !== 'render') await renderer?.settled()
      if (request.kind === 'dispose') {
        enableVideoEditRenderDiagnostics(false)
        fonts?.dispose(); fonts = undefined
        await disposeRenderer(); const codeResources = renderer?.codeDiagnostics(); renderer = undefined
        gridCells?.dispose(); gridCells = undefined
        // Every borrowed native frame goes back before the session may terminate this worker (record 002).
        await nativeFrames?.dispose(); nativeFrames = undefined; nativeDiagnostics = undefined
        self.postMessage({ id: request.id, codeResources } satisfies RenderResponse)
      } else if (request.kind === 'hoverFrame') {
        const controller = new AbortController(); hoverRequest = controller
        try {
          const hoverBytes = requestedHoverEpoch === hoverEpoch && foregroundFrames === 0 && renderer ? await renderer.captureHoverFrame(request.document, request.frame, request.allowRender, controller.signal) : undefined
          self.postMessage({ id: request.id, hoverBytes: controller.signal.aborted ? undefined : hoverBytes } satisfies RenderResponse)
        } finally { if (hoverRequest === controller) hoverRequest = undefined }
      } else if (request.kind === 'authorRelease') {
        await renderer?.releaseAuthor(request.url); await releaseAuthorCandidate(request.url)
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'fingerprint') {
        if (!renderer) throw new Error('剪辑渲染会话尚未初始化。')
        fingerprints ??= new VideoEditCodeFingerprint(renderer.document)
        const values = await fingerprints.frames(request.clipId, request.frame, request.endFrame, request.webContent, request.budgetMs)
        self.postMessage({ id: request.id, fingerprints: values } satisfies RenderResponse)
      } else if (request.kind === 'authorMetadata') {
        if (!renderer) throw new Error('剪辑渲染会话尚未初始化。')
        const authorMetadata = await readAuthorCandidateMetadata(request.url, request.apiVersion, request.bundle)
        self.postMessage({ id: request.id, authorMetadata } satisfies RenderResponse)
      } else if (request.kind === 'authorFrame') {
        if (!renderer) throw new Error('剪辑渲染会话尚未初始化。')
        try {
          const result = await renderer.renderAuthorFrame(request.url, request.params, request.info, request.assets, request.options, authorController!.signal)
          self.postMessage({ id: request.id, bitmap: result.bitmap, gpuMs: result.elapsedMs, elements: result.elements } satisfies RenderResponse, { transfer: [result.bitmap] })
        } finally { if (authorRequests.get(request.url) === authorController) authorRequests.delete(request.url) }
      } else if (request.kind === 'fonts') {
        const started = performance.now()
        if (request.fonts.length) {
          fonts ??= new LoadedFontFaces((self as unknown as { fonts: FontFaceSet }).fonts)
          fonts.retainIds(request.availableIds)
          for (const payload of request.fonts) await fonts.load(payload)
        }
        fonts?.retainIds(request.availableIds)
        if (request.reset && !request.fixedTextFonts) {
          textController.abort()
          await textQueue
          textController = new AbortController()
          await fingerprints?.dispose(); fingerprints = undefined
          await renderer?.invalidateFontResources()
          await closeAuthorCandidates()
          if (!request.fixedTextFonts) renewTextFontLease()
        }
        recordVideoEditPreparation('fontLoad', performance.now() - started)
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'init') {
        await disposeRenderer(); gridCells?.dispose(); gridCells = request.gridCells ? new VideoEditGridCells(request.gridCells.surfaces, request.gridCells.columns) : undefined
        direct = !!request.surface || !!gridCells; renderer = new VideoEditRenderer(request.document, { previewWidth: request.previewWidth, cacheWebOutput: request.cacheWebOutput, surface: request.surface, cacheBudgetBytes: request.cacheBudgetBytes, device: request.device, frames: frameBackend(request.decode), sequencePath: [request.document.id], timing: timingEvent, jumpPreviewLog: log, ...(gridCells ? { fitPicturesToTarget: true } : {}) })
        const current = renderer
        // 顺播只在画面来源变化时通知；来源含网页画面的实际来源，节目据此判断屏幕上的画面能否直接收录。
        let playbackSource: string | undefined
        current.onPresentation = (frame, presentedSource, exact, provenance) => {
          if (latestRender?.sequential) {
            const source = `${presentedSource}:${provenance ?? 'live'}`
            if (playbackSource === source) return
            playbackSource = source
          } else playbackSource = undefined
          const authorElements = backgroundElements === frame && exact && presentedSource === 'live' ? current.observeAuthorElements(frame) : undefined
          self.postMessage({ id: 0, phase: 'presented', frame, provenance, presentedSource, ...(authorElements ? { authorElements } : {}) } satisfies RenderResponse)
        }
        renderer.onPlaybackIdle = () => { if (renderer && latestRender) { const composition = renderer.document, { frame, sequential } = latestRender; probeVideoEditTask('lookahead.update', () => decodeLookahead?.update(composition, frame, sequential, renderCacheWindows)) } }
        renderer.setRenderCache(renderCacheWindows)
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'replaceContent') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        releasePreopened(); setProxies(undefined); setLocalPaths(request.localPaths)
        setVideoEditTrackResults({}); setVideoEditSmartRegionSegments({}); effectWarnings.clear()
        await renderer.replaceContent(request.document)
        // 前瞻按旧内容留着的闲置会话（文件已没人读，靠下一帧的前瞻回收）在换内容后不会再有那一帧：当场关闭。
        // 节目会话保留期间（换成空内容）因此不占解码会话与显存。
        await nativeBackend?.disposeIdle()
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'update') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        setProxies(request.proxies)
        setLocalPaths(request.localPaths)
        await renderer.updateDocument(request.document); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'parameters') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        renderer.updateParameters(request.update); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'render') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        // 排队期间已被更新的画面请求取代（见 `queuedFrames`），已答复过。
        backgroundRender = !!outsidePreview && await outsidePreview
        if (outsidePreview && latestRender !== request) {
          if (backgroundRender && !request.scrubbing) self.postMessage({ id: request.id, phase: 'refined', presented: false } satisfies RenderResponse)
          if (!backgroundRender && !skipped) { releaseForeground(); self.postMessage({ id: request.id, presented: false, skipped: true } satisfies RenderResponse) }
          return
        }
        if (backgroundRender && latestForegroundRequest !== request) {
          if (!request.scrubbing) self.postMessage({ id: request.id, phase: 'refined', presented: false } satisfies RenderResponse)
          return
        }
        if (backgroundRender && request.scrubbing) return
        if (skipped) return
        queuedFrames.delete(request.id)
        if (cancelledByStop()) { releaseForeground(); self.postMessage({ id: request.id, presented: false, skipped: true } satisfies RenderResponse); return }
        if (request.encode && !encoders.has(request.encode.stream)) throw new DOMException('视频编码已停止。', 'AbortError')
        const renderStarted = performance.now()
        beginVideoEditGpuFrame()
        const preparationBefore = videoEditPreparationSnapshot()
        traceVideoEditFrame('worker.queue', request.frame, receivedAt, renderStarted)
        let snapshot: Promise<ImageBitmap> | undefined
        // A canvas texture expires across asynchronous boundaries. Copy in the draw
        // submission, before awaiting GPU completion or tearing down a trial session.
        const needsPixels = !direct || !!request.readRgb
        // 多机位网格：整张网格在同次提交里拷成 GPU 位图，随后切给各格子的画布，不交回界面线程。
        const cells = !request.readRgb && !request.history ? gridCells : undefined
        const capture = request.history || needsPixels || cells ? Object.assign((pixels: Promise<ImageBitmap>): void => {
          if (snapshot) void snapshot.then(bitmap => bitmap.close(), () => {})
          snapshot = pixels
          void snapshot.catch(() => {})
        }, { maxPixels: needsPixels || cells ? Infinity : 1280 * 720, gpu: (!direct || !!cells) && !request.readRgb && !request.history }) : undefined
        pixelRendering = !!capture || request.requireLive === true
        if (backgroundRender) { backgroundComposition = renderer.document; backgroundRenderId = request.id }
        backgroundElements = backgroundRender && request.observeElements ? request.frame : undefined
        const result = await renderer.render(request.frame, request.sequential, request.scrubbing, () => renderer?.document.revision === revision && !cancelledByStop() && (!backgroundRender || latestRender === request), request.deadline, undefined, request.quality, capture, request.requireLive || backgroundRender, presentationOrder, request.observeElements, request.readRgb || request.history ? 'exact' : request.precision).catch(error => { if (snapshot) void snapshot.then(bitmap => bitmap.close(), () => {}); throw error }).finally(() => { pixelRendering = false; backgroundElements = undefined })
        const renderStages = { ...videoEditPreparationDelta(preparationBefore), ...result.renderStages }
        renderStages.queue = renderStarted - receivedAt
        // 本帧合成提交的 GPU 分段（诊断时才有）；下一帧开始前取走，不和后面的帧混在一起。
        const gpuStages = takeVideoEditGpuFrame()
        releaseForeground()
        const composition = renderer.document
        if (result.presented) probeVideoEditTask('lookahead.update', () => decodeLookahead?.update(composition, request.frame, request.sequential === true, renderCacheWindows))
        // 命中渲染缓存等没有跑代码的帧不会清空上一帧的记录，只报这一帧自己的。
        const readCodePerformance = renderer.captureCodePerformance()
        // 跳转先出的近似画面（预渲染的常驻关键帧）没有跑这一帧的代码：作者元素等随后的精确帧再读。
        const authorElements = request.observeElements && result.presented && result.presentedSource === 'live' && !result.approximate ? renderer.observeAuthorElements(request.frame, true) : undefined
        traceVideoEditFrame('worker.render', request.frame, renderStarted)
        if (cells && snapshot) {
          const pixels = await snapshot
          snapshot = undefined
          try { if (result.presented) cells.present(pixels) } finally { pixels.close() }
        }
        // 导出与预渲染：合成设备拷出的位图在这里直接送进编码器，不交回界面线程。像素已由 GPU 同步令牌保护，
        // 不必等这一帧 GPU 完成；完成与故障仍在下面的 finish 里核对，故障时这一帧按失败答复。
        let encoded: VideoEditFrameEncodeTiming | undefined
        if (request.encode) {
          const pixels = snapshot ? await snapshot : undefined
          snapshot = undefined
          const stream = encoders.get(request.encode.stream)
          if (!stream || !result.presented || !pixels) { pixels?.close(); throw stream ? new Error('剪辑渲染没有返回画面。') : new DOMException('视频编码已停止。', 'AbortError') }
          encoded = await stream.encode(pixels, request.encode)
        }
        const finish = async (): Promise<void> => {
          const owned = new Set<ImageBitmap>()
          try {
          const start = performance.now()
          for (const message of result.effectErrors ?? []) if (!effectWarnings.has(message)) log('warn', message, 'video_edit.effect.skipped', { sequenceId: renderer?.document.id, frame: request.frame })
          effectWarnings = new Set(result.effectErrors)
          const gpuFault = await frameGpuFault(result.completion, needsPixels || !!request.history || request.requireLive === true)
          const frameErrors = [...(result.effectErrors ?? []), ...(result.sceneIssues ?? []), ...(gpuFault ? [gpuFault.message] : [])]
          traceVideoEditFrame('compositor.complete', request.frame, start)
          recordVideoEditPreparation('presentComplete', performance.now() - start)
          // 流水播放会主动等待刷新时刻，这段等待不是计算瓶颈，不能使正常画面标红；送进编码器的时间另行报告。
          const encodeSpentMs = encoded ? encoded.copyMs + encoded.encodeMs + encoded.encodeWaitMs : 0
          const renderElapsedMs = Math.max(0, performance.now() - renderStarted - (renderStages.presentDeadline ?? 0) - encodeSpentMs)
          renderStages.presentComplete = performance.now() - start
          renderStages.decode = result.decodeMs
          renderStages.composite = Math.max(0, result.gpuMs - (renderStages.presentDeadline ?? 0))
          if (videoEditRenderDiagnosticsEnabled()) {
            // gpuMs 含等刷新时刻；诊断分开给出“等刷新时刻”“等 GPU 完成”与 GPU 时间戳量到的执行时间。
            renderStages['gpu.waitDisplay'] = renderStages.presentDeadline ?? 0
            renderStages['gpu.waitCompletion'] = renderStages.presentComplete
            if (result.presented) Object.assign(renderStages, await gpuStages?.catch(() => undefined))
            if (request.sentAt !== undefined) Object.assign(renderStages, videoEditDeliveryStages(request.sentAt, performance.timeOrigin + receivedAt))
          }
          const transferStarted = performance.now()
          const pixels = snapshot ? await snapshot : undefined
          if (pixels) owned.add(pixels)
          if (!encoded && result.presented && (needsPixels || request.history) && !pixels) throw new Error('剪辑渲染没有返回画面快照。')
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
          if (backgroundRender) self.postMessage({ id: request.id, phase: 'refined', provenance: result.provenance, frame: request.frame, sequenceId: composition.id, revision: composition.revision, presented: result.presented && latestRender === request && revision === composition.revision, effectErrors: frameErrors, ...(gpuFault ? { gpuFrame: gpuFault.facts } : {}) } satisfies RenderResponse)
          if (!backgroundRender) {
          probeVideoEditTask('render.post', () => self.postMessage({ id: request.id, ...(result.superseded && latestRender !== request || !result.presented && cancelledByStop() ? { skipped: true } : {}), provenance: result.provenance, renderCached: result.renderCached, renderElapsedMs, renderStages, bitmap, history, rgb, authorElements, effectErrors: result.sceneIssues || gpuFault ? frameErrors : result.effectErrors, ...(gpuFault ? { gpuFrame: gpuFault.facts } : {}), ...(result.sceneIssues ? { sceneIssues: result.sceneIssues } : {}), sourceTimestamps: result.sourceTimestamps, blankPictures: result.blankPictures, singleFrameReads: result.singleFrameReads, cacheHits: result.cacheHits, cacheBytes: result.cacheBytes, presented: result.presented, presentedSource: result.presentedSource, ...(result.approximate ? { approximate: true } : {}), ...(result.spaceProgress !== undefined ? { spaceProgress: result.spaceProgress } : {}), decodeMs: result.decodeMs, gpuMs: result.gpuMs + performance.now() - start, codeResources: renderer?.codeDiagnostics(), codePerformance: readCodePerformance().filter(sample => sample.frame === request.frame), ...(encoded ? { encoded } : {}), ...(videoEditRenderDiagnosticsEnabled() ? { preparationStages: videoEditPreparationSnapshot() } : {}) } satisfies RenderResponse, { transfer: [...(rgb ? [rgb.buffer as ArrayBuffer] : bitmap ? [bitmap] : []), ...(history ? [history] : [])] }))
          }
          if (bitmap) owned.delete(bitmap)
          traceVideoEditFrame('worker.post', request.frame, postedAt)
          if (history) owned.delete(history)
          } catch (error) {
            if (!owned.size && snapshot) void snapshot.then(bitmap => bitmap.close(), () => {})
            throw error
          } finally {
            owned.forEach(bitmap => bitmap.close())
            if (result.presented && renderer) { const latest = renderer.document; probeVideoEditTask('lookahead.update', () => decodeLookahead?.update(latest, request.frame, request.sequential === true, renderCacheWindows)) }
            if (request.sequential && performance.now() - summaryAt >= 5000) lookaheadSummary('interval')
          }
        }
        // 拖动与正向播放：提交后先回执，下一帧不必等这一帧的 GPU 完成（节目监视器两帧流水）。
        // 送进编码流的帧同样先回执：界面线程随即发下一帧，GPU 完成、编码与下一帧合成并行。
        if (encoded || direct && !request.history && (request.scrubbing || (request.sequential && request.deadline !== undefined))) {
          self.postMessage({ id: request.id, phase: 'submitted' } satisfies RenderResponse)
          void finish().catch(error => self.postMessage({ id: request.id, ...videoEditRenderFailure(error) } satisfies RenderResponse))
        } else await finish()
      } else if (request.kind === 'stopPlayback') {
        lookaheadSummary('stop')
        if (videoEditRenderDiagnosticsEnabled()) log('info', 'Worker 事件循环迟滞汇总', 'video_edit.worker.lag.summary', { sequenceId: renderer?.document.id, ...videoEditLagSummary() })
        await renderer?.stopPlayback()
        if (renderer) { decodeLookahead?.beforeFrame(renderer.document, request.frame, false); decodeLookahead?.update(renderer.document, request.frame, false, renderCacheWindows) }
      } else if (request.kind === 'encoderOpen') {
        closeEncoder(request.stream)
        const stream = request.stream
        const encoder = await VideoEditFrameEncoder.open(request.config, request.output, chunk => self.postMessage({ kind: 'encoder.chunk', stream, chunk } satisfies VideoEditEncodedChunkMessage, [chunk.data]))
        encoders.set(stream, encoder)
        // 合成画面与成片同尺寸时位图直接构造 VideoFrame（GPU 上一次拷贝、不回读）；画幅不同时经 Worker 里的 2D 画布缩放一次。
        // 预渲染每个窗口开一条，只记 debug；成片导出记 info。
        const exporting = request.purpose === 'export'
        log(exporting ? 'info' : 'debug', '剪辑渲染线程视频编码已打开', exporting ? 'video_edit.export.encoder.opened' : 'video_edit.render_cache.encoder.opened', { stream, codec: request.config.codec, width: request.config.width, height: request.config.height, hardwareAcceleration: request.config.hardwareAcceleration, capture: request.output ? 'scaled' : 'gpu-bitmap', ...(request.output ? { reason: '成片画幅与合成画面不同，按导出几何缩放' } : {}) })
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'encoderFlush') {
        const stream = encoders.get(request.stream)
        if (!stream) throw new DOMException('视频编码已停止。', 'AbortError')
        try { await stream.flush() } finally { closeEncoder(request.stream) }
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'prepareGpu') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        await renderer.prepareGpu(); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'arm') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        await renderer.armPlayback(request.frame, request.precision); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'scale') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        renderer.setRenderDivisor(request.divisor); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'webDisplayScale') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        renderer.setWebDisplayScale(request.scale); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'denoiser') {
        setVideoEditDenoiserWeights(request.url); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'spaceDisplay') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        renderer.setSpaceDisplay(request.display); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'outputScale') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        renderer.setOutputScale(request.scale, request.renderAtOutputResolution); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'precision') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        const precision = await renderer.precisionDiagnostics(request.row)
        self.postMessage({ id: request.id, precision } satisfies RenderResponse, { transfer: precision.row ? [precision.row.buffer as ArrayBuffer] : [] })
      } else {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        const channels = await renderer.mixAudio(request.start, request.duration, request.retainIdle === true)
        self.postMessage({ id: request.id, channels } satisfies RenderResponse, { transfer: channels.map(channel => channel.buffer as ArrayBuffer) })
      }
    } catch (error) {
      releaseForeground()
      if (backgroundRender) {
        const failure = videoEditRenderFailure(error)
        // 同帧的新请求也有独立生命周期；旧任务的取消不能变成新画面的失败，设备丢失则影响整个会话。
        if (failure.gpuDeviceLost === undefined && (latestRender !== request || revision !== backgroundComposition?.revision)) { self.postMessage({ id: request.id, phase: 'refined', presented: false } satisfies RenderResponse); return }
        log('warn', '暂停画面的后台现场合成未完成', 'video_edit.preview.detached_frame.failed', { frame: request.kind === 'render' ? request.frame : undefined, ...failure })
        self.postMessage({ id: request.id, phase: 'refined', frame: request.kind === 'render' ? request.frame : undefined, sequenceId: backgroundComposition?.id, revision: backgroundComposition?.revision, ...failure } satisfies RenderResponse)
      }
      else self.postMessage({ id: request.id, ...videoEditRenderFailure(error), ...(error instanceof VideoEditEncoderFailure ? { encoderFailure: { reason: error.reason, detail: error.message } } : {}) } satisfies RenderResponse)
    } finally { if (backgroundRenderId === request.id) backgroundRenderId = undefined }
  })
}

log('debug', '剪辑 Worker 模块已加载', 'video_edit.worker.loaded', { loadedAt: performance.timeOrigin + performance.now() })
