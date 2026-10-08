import type { SelectionRasterRequestV3 } from './selectionRaster.worker'

export class ImageEditSelectionRasterClientV3 {
  private worker = new Worker(new URL('./selectionRaster.worker.ts', import.meta.url), { type: 'module' })
  private busy = false
  private disposed = false
  private cancelPending: (() => void) | null = null
  async rasterize(request: SelectionRasterRequestV3, signal?: AbortSignal): Promise<Float32Array> {
    if (this.busy) throw new Error('选区栅格化请求必须串行')
    if (this.disposed || signal?.aborted) throw new Error('CANCELLED')
    this.busy = true
    try {
      return await new Promise<Float32Array>((resolve, reject) => {
        const cleanup = () => { this.worker.onmessage = null; this.worker.onerror = null; signal?.removeEventListener('abort', abort); this.cancelPending = null }
        const abort = () => this.dispose()
        this.cancelPending = () => { cleanup(); reject(new Error('CANCELLED')) }
        signal?.addEventListener('abort', abort, { once: true })
        this.worker.onmessage = (event: MessageEvent<{ coverage?: Float32Array; error?: string }>) => {
          cleanup()
          if (event.data.coverage) resolve(event.data.coverage)
          else reject(new Error(event.data.error ?? '选区栅格化结果缺失'))
        }
        this.worker.onerror = (event) => { cleanup(); reject(new Error(event.message)) }
        try { this.worker.postMessage(request) } catch (error) { cleanup(); reject(error) }
      })
    } finally { this.busy = false }
  }
  dispose(): void { this.disposed = true; this.worker.terminate(); this.cancelPending?.() }
}
