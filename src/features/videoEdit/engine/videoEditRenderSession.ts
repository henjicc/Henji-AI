import { verifiedVideoEditProxySources } from '../application/videoEditProxy'
import type { VideoProxyResult } from '@/core/videoEdit/proxy'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { isLikelyLocalImagePath, toFetchableMediaUrl } from '@/services/imageSource'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import type { NativeFramesRequest, RenderDecodeOptions, RenderLogMessage, RenderRequest, RenderResponse } from './videoEditWorker'
import { VideoEditMediaContentVerifier } from '../videoEditMediaContent'
import type { VideoEditTrackResults } from './videoEditTrackResults'
import type { VideoEditSmartRegionSegments } from './videoEditSmartRegionMasks'

const logger = createLogger('features.videoEdit.render')

/** A bounded request stream owned by a view/export, independent from the project lifetime. */
export class VideoEditRenderSession {
  private readonly worker = new Worker(new URL('./videoEditWorker.ts', import.meta.url), { type: 'module' })
  private readonly pending = new Map<number, { resolve: (value: RenderResponse) => void; reject: (error: Error) => void; submitted?: () => void }>()
  private nextId = 0
  private disposed = false
  private readonly ready: Promise<RenderResponse>
  private readonly content = new VideoEditMediaContentVerifier()
  /** The frame channel handed to the worker for native decoding, disconnected after the worker is gone. */
  private route?: string
  readonly canvas: OffscreenCanvas
  get previewPreparationMs(): number { return 0 }
  get previewBytes(): number { return 0 }
  private readonly lutRoots = new Set<string>()
  private async authorizeLuts(document: VideoEditComposition): Promise<void> {
    for (const asset of document.lumetriLuts ?? []) {
      if (this.lutRoots.has(asset.path)) continue
      const platform = getPlatform()
      await platform.media.allowRoot(await platform.system.paths.dirname(asset.path))
      this.lutRoots.add(asset.path)
    }
  }
  private proxies: Record<string, VideoProxyResult> = {}
  private async selectProxies(original = false): Promise<void> { this.proxies = this.proxyProjectId && !original ? await verifiedVideoEditProxySources(this.proxyProjectId, this.exportProxies) : {} }
  private proxySources(): Record<string, VideoProxyResult> { return Object.fromEntries(Object.entries(this.proxies).map(([id, result]) => [id, { ...result, path: toFetchableMediaUrl(result.path) }])) }
  private mediaDocument(document: VideoEditComposition): VideoEditComposition { return { ...document, media: document.media.map(media => ({ ...media, path: toFetchableMediaUrl(media.path), ...(this.proxies[media.id] ? { sourceRevision: `${media.sourceRevision ?? ''}:proxy:${this.proxies[media.id].key}` } : {}) })), ...(document.lumetriLuts ? { lumetriLuts: document.lumetriLuts.map(asset => ({ ...asset, path: toFetchableMediaUrl(asset.path) })) } : {}) } }
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
      const status = await platform.videoDecoder.status()
      forced = status.forcedBackend ?? undefined
      if (!status.available || forced === 'browser' || this.disposed) return { nativeAvailable: false, ...(forced ? { forced } : {}) }
      const channel = await platform.videoFrames.connect()
      if (this.disposed) { platform.videoFrames.disconnect(channel.route); return { nativeAvailable: false } }
      this.route = channel.route
      this.worker.postMessage({ kind: 'nativeFrames.attach', port: channel.port } satisfies NativeFramesRequest, [channel.port])
      return { nativeAvailable: true, ...(forced ? { forced } : {}) }
    } catch (error) {
      logger.warn('原生解码通道不可用，剪辑预览只用后备解码', { event: 'video_edit.decode.native.channel_failed', error })
      return { nativeAvailable: false, ...(forced ? { forced } : {}) }
    }
  }
  constructor(private document: VideoEditComposition, previewWidth?: number, _preparing?: (active: boolean) => void, surface?: OffscreenCanvas, cacheBudgetBytes?: number, private readonly proxyProjectId?: string, private readonly exportProxies = false) {
    // Preview owns the transferred full-size surface; reserve the export scratch lazily.
    this.canvas = new OffscreenCanvas(previewWidth ? 1 : document.width, previewWidth ? 1 : document.height)
    this.worker.onmessage = (event: MessageEvent<RenderResponse | RenderLogMessage>) => {
      if ('kind' in event.data) { const entry = event.data; logger[entry.level](entry.message, { event: entry.event, context: entry.context }); return }
      const value = event.data; const pending = this.pending.get(value.id)
      if (value.phase === 'submitted') { pending?.submitted?.(); return }
      this.pending.delete(value.id)
      if (!pending) { value.bitmap?.close(); return }
      if (value.error) pending.reject(new Error(value.error)); else pending.resolve(value)
    }
    this.worker.onerror = event => { for (const pending of this.pending.values()) pending.reject(new Error(event.message)); this.pending.clear() }
    this.ready = Promise.all([this.selectProxies(), this.content.check(document), this.connectNative(), this.authorizeLuts(document)]).then(([, , decode]) => this.request({ kind: 'init', document: this.mediaDocument(document), previewWidth, surface, cacheBudgetBytes, decode: { ...decode, localPaths: this.localPaths(document), proxies: this.proxySources() } }, surface ? [surface] : []))
    void this.ready.catch(() => undefined)
  }
  private request(request: RenderRequest extends infer T ? T extends RenderRequest ? Omit<T, 'id'> : never : never, transfer: Transferable[] = [], submitted?: () => void): Promise<RenderResponse> {
    if (this.disposed) return Promise.reject(new Error('剪辑渲染已关闭。'))
    if (this.pending.size >= 3) return Promise.reject(new Error('剪辑渲染请求过多。'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, submitted }); this.worker.postMessage({ ...request, id }, transfer) })
  }
  async updateDocument(document: VideoEditComposition, original = false): Promise<void> { await this.ready; await this.selectProxies(original); await this.content.check(document); await this.authorizeLuts(document); await this.request({ kind: 'update', document: this.mediaDocument(document), localPaths: this.localPaths(document), proxies: this.proxySources() }); this.document = document }
  /** Preview only (task 4.9): later frames draw at 1/divisor of the sequence size; resolves once the worker applied it. */
  async setRenderDivisor(divisor: number): Promise<void> { await this.ready; await this.request({ kind: 'scale', divisor }) }
  /** Paused preview only: positions forward playback at this frame ahead of play, so pressing play starts at once. */
  async armPlayback(frame: number): Promise<void> { await this.ready; await this.request({ kind: 'arm', frame }) }
  /** 智能区域（4.7d）：已分析好的段落交给 Worker，下一次渲染即使用。 */
  setSmartRegions(regions: VideoEditSmartRegionSegments): void { if (!this.disposed) this.worker.postMessage({ kind: 'regions', regions, id: 0 } satisfies RenderRequest) }
  setTracks(tracks: VideoEditTrackResults): void { if (!this.disposed) this.worker.postMessage({ kind: 'tracks', tracks, id: 0 } satisfies RenderRequest) }
  invalidateDocument(revision: number): void { if (!this.disposed) this.worker.postMessage({ kind: 'invalidate', revision, id: 0 } satisfies RenderRequest) }
  async present(frame: number, sequential = false, scrubbing = false, deadline?: number, submitted?: () => void, readRgb?: { width: number; height: number }): Promise<RenderResponse> {
    await this.ready
    return this.request({ kind: 'render', frame, sequential, scrubbing, deadline, ...(readRgb ? { readRgb } : {}) }, [], submitted)
  }
  async renderBitmap(frame: number, sequential = false, scrubbing = false): Promise<RenderResponse & { bitmap: ImageBitmap }> {
    const result = await this.present(frame, sequential, scrubbing)
    if (!result.bitmap) throw new Error('剪辑渲染没有返回画面。')
    return { ...result, bitmap: result.bitmap }
  }
  /** Export frames: sequential renders on this session's full-size canvas (task 2.4: exact pictures or a failure). */
  async render(frame: number, sequential = false): Promise<{ canvas: OffscreenCanvas; sourceTimestamps: number[]; singleFrameReads: number }> {
    const result = await this.renderBitmap(frame, sequential)
    try { this.canvas.getContext('2d')!.drawImage(result.bitmap, 0, 0) } finally { result.bitmap.close() }
    return { canvas: this.canvas, sourceTimestamps: result.sourceTimestamps ?? [], singleFrameReads: result.singleFrameReads ?? 0 }
  }
  async mixAudio(start: number, duration: number): Promise<AudioBuffer> {
    await this.ready
    const { channels } = await this.request({ kind: 'audio', start, duration })
    if (!channels?.length) throw new Error('剪辑混音没有返回声音。')
    const buffer = new AudioBuffer({ numberOfChannels: channels.length, sampleRate: this.document.sampleRate, length: channels[0].length })
    channels.forEach((channel, index) => buffer.getChannelData(index).set(channel))
    return buffer
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.content.dispose()
    for (const pending of this.pending.values()) pending.reject(new Error('剪辑渲染已关闭。'))
    this.pending.clear()
    const id = ++this.nextId
    let timer: ReturnType<typeof setTimeout> | undefined
    const closed = new Promise<RenderResponse>((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ kind: 'dispose', id } satisfies RenderRequest) })
    const limit = new Promise<void>(resolve => { timer = setTimeout(resolve, 2000) })
    await Promise.allSettled([Promise.race([closed, limit])])
    clearTimeout(timer); this.worker.terminate(); this.pending.clear(); this.canvas.width = 1; this.canvas.height = 1
    // Closes the port and any native session the worker could not close itself.
    if (this.route) { const route = this.route; this.route = undefined; try { getPlatform().videoFrames.disconnect(route) } catch { /* the platform is gone with the page */ } }
  }
}
