import { VideoEditRenderer } from './videoEditRenderer'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { VideoEditNativeFrameReceiver } from './videoEditNativeFrames'
import { NativeFrameDiagnostics, type NativeFrameDiagnosticsRequest, type NativeFrameDiagnosticsResult } from './videoEditNativeFrameDiagnostics'
import { VideoEditBrowserFrames } from './videoEditBrowserFrames'
import { VideoEditNativeFrames } from './videoEditNativeFrameSource'
import { VideoEditFrameRouter, type VideoEditDecodeSettings } from './videoEditFrameRouter'
import { setVideoEditTrackResults, type VideoEditTrackResults } from './videoEditTrackResults'
import { setVideoEditSmartRegionSegments, type VideoEditSmartRegionSegments } from './videoEditSmartRegionMasks'

/**
 * Decoding settings of one render session. `localPaths` maps each media item's fetchable URL (its path in the worker)
 * to the local file the native decoder reads.
 */
export interface RenderDecodeOptions extends VideoEditDecodeSettings { localPaths?: Record<string, string> }
export type RenderRequest = { id: number } & (
  { kind: 'init'; document: VideoEditComposition; previewWidth?: number; surface?: OffscreenCanvas; cacheBudgetBytes?: number; decode?: RenderDecodeOptions } | { kind: 'update'; document: VideoEditComposition; localPaths?: Record<string, string> }
  | { kind: 'invalidate'; revision: number }
  /** Preview playback resolution (task 4.9): the next renders draw at 1/divisor of the sequence size. */
  | { kind: 'scale'; divisor: number }
  /** 已分析好的智能区域段落（4.7d），按素材地址与分析种类；不进渲染队列，下一次渲染即生效。 */
  | { kind: 'tracks'; tracks: VideoEditTrackResults }
  | { kind: 'regions'; regions: VideoEditSmartRegionSegments }
  | { kind: 'dispose' }
  | { kind: 'render'; frame: number; sequential: boolean; scrubbing?: boolean; deadline?: number }
  | { kind: 'audio'; start: number; duration: number }
  /** Acceptance probes only (task 2.7): high-precision counters and one row of the last high-precision composition. */
  | { kind: 'precision'; row?: number })
export type RenderResponse = { id: number; phase?: 'submitted'; error?: string; bitmap?: ImageBitmap; sourceTimestamps?: number[]; blankPictures?: number; singleFrameReads?: number; channels?: Float32Array[]; cacheHits?: number; cacheBytes?: number; presented?: boolean; decodeMs?: number; gpuMs?: number; codeResources?: ReturnType<VideoEditRenderer['codeDiagnostics']>; precision?: Awaited<ReturnType<VideoEditRenderer['precisionDiagnostics']>> }
/** Structured log entries the worker cannot write itself; the render session forwards them to the application log. */
export interface RenderLogMessage { kind: 'log'; level: 'info' | 'warn'; message: string; event: string; context: Record<string, unknown> }
/** 原生显卡帧通道（preload 交来的端口）。不进入渲染队列；渲染器经它读取原生解码帧，诊断只供真实性测试。 */
export type NativeFramesRequest =
  | { kind: 'nativeFrames.attach'; port: MessagePort }
  | { kind: 'nativeFrames.diagnose'; id: number; request: NativeFrameDiagnosticsRequest }
export type NativeFramesResponse = { id: number; nativeFrames?: NativeFrameDiagnosticsResult; error?: string }
let renderer: VideoEditRenderer | undefined
let direct = false
let revision = 0
let queue = Promise.resolve()
let nativeFrames: VideoEditNativeFrameReceiver | undefined
let nativeDiagnostics: NativeFrameDiagnostics | undefined
let nativeBackend: VideoEditNativeFrames | undefined
let router: VideoEditFrameRouter | undefined
const localPaths = new Map<string, string>()
function setLocalPaths(paths: Record<string, string> | undefined): void { if (!paths) return; localPaths.clear(); for (const [url, path] of Object.entries(paths)) localPaths.set(url, path) }
const log = (level: RenderLogMessage['level'], message: string, event: string, context: Record<string, unknown>): void => { self.postMessage({ kind: 'log', level, message, event, context } satisfies RenderLogMessage) }
/** The renderer's decoding: the browser backend, plus native decoding when the frame channel is attached. */
function frameBackend(decode: RenderDecodeOptions | undefined): VideoEditFrameRouter {
  setLocalPaths(decode?.localPaths)
  const channel = decode?.nativeAvailable && decode.forced !== 'browser' ? nativeFrames : undefined
  // Runtime native failures are recovered per read by the router (task 3.1).
  nativeBackend = channel ? new VideoEditNativeFrames({ channel, localPath: media => localPaths.get(media.path) }) : undefined
  router = new VideoEditFrameRouter(new VideoEditBrowserFrames(), nativeBackend, { nativeAvailable: !!nativeBackend, ...(decode?.forced ? { forced: decode.forced } : {}) }, log)
  return router
}
/** Releases the renderer, then the native sessions it closed, then the frame channel (frames return before it closes). */
async function disposeRenderer(): Promise<void> {
  await renderer?.dispose()
  await nativeBackend?.settled(); router?.dispose()
  nativeBackend = undefined; router = undefined
}
function handleNativeFrames(request: NativeFramesRequest): void {
  if (request.kind === 'nativeFrames.attach') { void nativeFrames?.dispose(); nativeFrames = new VideoEditNativeFrameReceiver(request.port); nativeDiagnostics = undefined; return }
  const receiver = nativeFrames
  if (!receiver) { self.postMessage({ id: request.id, error: '原生帧通道尚未接入。' } satisfies NativeFramesResponse); return }
  // 渲染 Worker 按 IIFE 打包，不能按需拆分加载；诊断模块很小且只在收到诊断消息时实例化。
  nativeDiagnostics ??= new NativeFrameDiagnostics(receiver)
  void nativeDiagnostics.handle(request.request).then(
    result => self.postMessage({ id: request.id, nativeFrames: result } satisfies NativeFramesResponse),
    error => self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies NativeFramesResponse))
}
self.onmessage = (event: MessageEvent<RenderRequest | NativeFramesRequest>) => {
  if (event.data.kind === 'nativeFrames.attach' || event.data.kind === 'nativeFrames.diagnose') { handleNativeFrames(event.data); return }
  const request = event.data
  if (request.kind === 'tracks') { setVideoEditTrackResults(request.tracks); renderer?.cancelPresentation(); return }
  if (request.kind === 'regions') { setVideoEditSmartRegionSegments(request.regions); renderer?.cancelPresentation(); return }
  if (request.kind === 'invalidate') { if (revision !== request.revision) { revision = request.revision; renderer?.cancelPresentation() } return }
  if (request.kind === 'dispose') { revision = Number.MAX_SAFE_INTEGER; renderer?.cancelPresentation() }
  if (request.kind === 'init') revision = request.document.revision
  if (request.kind === 'update') revision = Math.max(revision, request.document.revision)
  queue = queue.then(async () => {
    try {
      if (request.kind === 'dispose') {
        await disposeRenderer(); const codeResources = renderer?.codeDiagnostics(); renderer = undefined
        // Every borrowed native frame goes back before the session may terminate this worker (record 002).
        await nativeFrames?.dispose(); nativeFrames = undefined; nativeDiagnostics = undefined
        self.postMessage({ id: request.id, codeResources } satisfies RenderResponse)
      } else if (request.kind === 'init') {
        await disposeRenderer(); renderer = new VideoEditRenderer(request.document, request.previewWidth, request.surface, request.cacheBudgetBytes, frameBackend(request.decode)); direct = !!request.surface
        self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'update') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        setLocalPaths(request.localPaths)
        await renderer.updateDocument(request.document); self.postMessage({ id: request.id } satisfies RenderResponse)
      } else if (request.kind === 'render') {
        if (!renderer) throw new Error('剪辑渲染器尚未就绪。')
        const result = await renderer.render(request.frame, request.sequential, request.scrubbing, () => renderer?.document.revision === revision, request.deadline)
        const finish = async (): Promise<void> => {
          const start = performance.now()
          await result.completion
          const bitmap = direct || !result.presented ? undefined : result.canvas.transferToImageBitmap()
          self.postMessage({ id: request.id, bitmap, sourceTimestamps: result.sourceTimestamps, blankPictures: result.blankPictures, singleFrameReads: result.singleFrameReads, cacheHits: result.cacheHits, cacheBytes: result.cacheBytes, presented: result.presented, decodeMs: result.decodeMs, gpuMs: result.gpuMs + performance.now() - start, codeResources: renderer?.codeDiagnostics() } satisfies RenderResponse, { transfer: bitmap ? [bitmap] : [] })
        }
        if (direct && request.scrubbing) {
          self.postMessage({ id: request.id, phase: 'submitted' } satisfies RenderResponse)
          void finish().catch(error => self.postMessage({ id: request.id, error: String(error) } satisfies RenderResponse))
        } else await finish()
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
