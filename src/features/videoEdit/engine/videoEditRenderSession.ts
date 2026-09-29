import type { VideoEditDocument } from '@/core/videoEdit/document'
import { toFetchableMediaUrl } from '@/services/imageSource'
import type { RenderRequest, RenderResponse } from './videoEditWorker'

/** A bounded request stream owned by a view/export, independent from the project lifetime. */
export class VideoEditRenderSession {
  private readonly worker = new Worker(new URL('./videoEditWorker.ts', import.meta.url), { type: 'module' })
  private readonly pending = new Map<number, { resolve: (value: RenderResponse) => void; reject: (error: Error) => void }>()
  private nextId = 0
  private disposed = false
  private readonly ready: Promise<RenderResponse>
  readonly canvas: OffscreenCanvas
  constructor(document: VideoEditDocument) {
    this.canvas = new OffscreenCanvas(document.width, document.height)
    this.worker.onmessage = (event: MessageEvent<RenderResponse>) => {
      const value = event.data; const pending = this.pending.get(value.id); this.pending.delete(value.id)
      if (!pending) { value.bitmap?.close(); return }
      if (value.error) pending.reject(new Error(value.error)); else pending.resolve(value)
    }
    this.worker.onerror = event => { for (const pending of this.pending.values()) pending.reject(new Error(event.message)); this.pending.clear() }
    this.ready = this.request({ kind: 'init', document: { ...document, media: document.media.map(media => ({ ...media, path: toFetchableMediaUrl(media.path) })) } })
  }
  private request(request: RenderRequest extends infer T ? T extends RenderRequest ? Omit<T, 'id'> : never : never): Promise<RenderResponse> {
    if (this.disposed) return Promise.reject(new Error('剪辑渲染已关闭。'))
    if (this.pending.size >= 3) return Promise.reject(new Error('剪辑渲染请求过多。'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ ...request, id }) })
  }
  async render(frame: number, sequential = false): Promise<{ canvas: OffscreenCanvas; sourceTimestamps: number[] }> {
    await this.ready
    const result = await this.request({ kind: 'render', frame, sequential })
    if (!result.bitmap) throw new Error('剪辑渲染没有返回画面。')
    try { this.canvas.getContext('2d')!.drawImage(result.bitmap, 0, 0) } finally { result.bitmap.close() }
    return { canvas: this.canvas, sourceTimestamps: result.sourceTimestamps ?? [] }
  }
  async mixAudio(start: number, duration: number): Promise<AudioBuffer> {
    await this.ready
    const { channels } = await this.request({ kind: 'audio', start, duration })
    if (!channels?.length) throw new Error('剪辑混音没有返回声音。')
    const buffer = new AudioBuffer({ numberOfChannels: channels.length, sampleRate: 48000, length: channels[0].length })
    channels.forEach((channel, index) => buffer.getChannelData(index).set(channel))
    return buffer
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true; this.worker.terminate()
    for (const pending of this.pending.values()) pending.reject(new Error('剪辑渲染已关闭。'))
    this.pending.clear(); this.canvas.width = 1; this.canvas.height = 1
  }
}
