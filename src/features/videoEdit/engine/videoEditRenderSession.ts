import type { VideoEditComposition } from '@/core/videoEdit/document'
import { toFetchableMediaUrl } from '@/services/imageSource'
import type { RenderRequest, RenderResponse } from './videoEditWorker'

/** A bounded request stream owned by a view/export, independent from the project lifetime. */
export class VideoEditRenderSession {
  private readonly worker = new Worker(new URL('./videoEditWorker.ts', import.meta.url), { type: 'module' })
  private readonly pending = new Map<number, { resolve: (value: RenderResponse) => void; reject: (error: Error) => void; submitted?: () => void }>()
  private nextId = 0
  private disposed = false
  private readonly ready: Promise<RenderResponse>
  readonly canvas: OffscreenCanvas
  get previewPreparationMs(): number { return 0 }
  get previewBytes(): number { return 0 }
  private mediaDocument(document: VideoEditComposition): VideoEditComposition { return { ...document, media: document.media.map(media => ({ ...media, path: toFetchableMediaUrl(media.path) })) } }
  constructor(private document: VideoEditComposition, previewWidth?: number, _preparing?: (active: boolean) => void, surface?: OffscreenCanvas) {
    // Preview owns the transferred full-size surface; reserve the export scratch lazily.
    this.canvas = new OffscreenCanvas(previewWidth ? 1 : document.width, previewWidth ? 1 : document.height)
    this.worker.onmessage = (event: MessageEvent<RenderResponse>) => {
      const value = event.data; const pending = this.pending.get(value.id)
      if (value.phase === 'submitted') { pending?.submitted?.(); return }
      this.pending.delete(value.id)
      if (!pending) { value.bitmap?.close(); return }
      if (value.error) pending.reject(new Error(value.error)); else pending.resolve(value)
    }
    this.worker.onerror = event => { for (const pending of this.pending.values()) pending.reject(new Error(event.message)); this.pending.clear() }
    this.ready = this.request({ kind: 'init', document: this.mediaDocument(document), previewWidth, surface }, surface ? [surface] : [])
  }
  private request(request: RenderRequest extends infer T ? T extends RenderRequest ? Omit<T, 'id'> : never : never, transfer: Transferable[] = [], submitted?: () => void): Promise<RenderResponse> {
    if (this.disposed) return Promise.reject(new Error('剪辑渲染已关闭。'))
    if (this.pending.size >= 3) return Promise.reject(new Error('剪辑渲染请求过多。'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, submitted }); this.worker.postMessage({ ...request, id }, transfer) })
  }
  async updateDocument(document: VideoEditComposition): Promise<void> { await this.ready; await this.request({ kind: 'update', document: this.mediaDocument(document) }); this.document = document }
  invalidateDocument(revision: number): void { if (!this.disposed) this.worker.postMessage({ kind: 'invalidate', revision, id: 0 } satisfies RenderRequest) }
  async present(frame: number, sequential = false, scrubbing = false, deadline?: number, submitted?: () => void): Promise<RenderResponse> {
    await this.ready
    return this.request({ kind: 'render', frame, sequential, scrubbing, deadline }, [], submitted)
  }
  async renderBitmap(frame: number, sequential = false, scrubbing = false): Promise<RenderResponse & { bitmap: ImageBitmap }> {
    const result = await this.present(frame, sequential, scrubbing)
    if (!result.bitmap) throw new Error('剪辑渲染没有返回画面。')
    return { ...result, bitmap: result.bitmap }
  }
  async render(frame: number, sequential = false): Promise<{ canvas: OffscreenCanvas; sourceTimestamps: number[] }> {
    const result = await this.renderBitmap(frame, sequential)
    try { this.canvas.getContext('2d')!.drawImage(result.bitmap, 0, 0) } finally { result.bitmap.close() }
    return { canvas: this.canvas, sourceTimestamps: result.sourceTimestamps ?? [] }
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
    for (const pending of this.pending.values()) pending.reject(new Error('剪辑渲染已关闭。'))
    this.pending.clear()
    const id = ++this.nextId
    let timer: ReturnType<typeof setTimeout> | undefined
    const closed = new Promise<RenderResponse>((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ kind: 'dispose', id } satisfies RenderRequest) })
    const limit = new Promise<void>(resolve => { timer = setTimeout(resolve, 2000) })
    await Promise.allSettled([Promise.race([closed, limit])])
    clearTimeout(timer); this.worker.terminate(); this.pending.clear(); this.canvas.width = 1; this.canvas.height = 1
  }
}
