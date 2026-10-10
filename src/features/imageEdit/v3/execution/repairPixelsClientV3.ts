import type { ImageEditRepairStructureV3 } from '@/core/imageEdit/v3/repairQuality'
import type { ImageEditRepairBitmapV3 } from '@/core/imageEdit/v3/repair'
import type { RepairPixelsRequestV3 } from './repairPixels.worker'
import type { TextureCompletionResult } from '@/core/imaging/retouch'
export class ImageEditRepairPixelsClientV3 {
  private worker = new Worker(new URL('./repairPixels.worker.ts', import.meta.url), { type: 'module' })
  private rejectPending: (() => void) | null = null
  private disposed = false
  async run(input: RepairPixelsRequestV3, signal: AbortSignal): Promise<{ bitmap?: ImageEditRepairBitmapV3; data?: Float32Array; resolved?: Uint8Array; remaining?: number; structure?: ImageEditRepairStructureV3; texture?: TextureCompletionResult }> {
    if (this.disposed || signal.aborted) throw new Error('CANCELLED')
    if (this.rejectPending) throw new Error('修补像素请求必须串行')
    return new Promise((resolve, reject) => {
      const cleanup = (): void => { this.worker.onmessage = null; this.worker.onerror = null; this.worker.onmessageerror = null; signal.removeEventListener('abort', abort); this.rejectPending = null }
      const abort = (): void => this.dispose()
      this.rejectPending = () => { cleanup(); reject(new Error('CANCELLED')) }
      signal.addEventListener('abort', abort, { once: true })
      this.worker.onmessage = (event: MessageEvent<{ bitmap?: ImageEditRepairBitmapV3; data?: Float32Array; resolved?: Uint8Array; remaining?: number; structure?: ImageEditRepairStructureV3; texture?: TextureCompletionResult; error?: string }>) => { cleanup(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data) }
      this.worker.onerror = event => { cleanup(); reject(new Error(event.message)) }
      this.worker.onmessageerror = () => { cleanup(); reject(new Error('修补像素结果传输失败')) }
      try { this.worker.postMessage(input) } catch (error) { cleanup(); reject(error) }
    })
  }
  dispose(): void { this.disposed = true; this.worker.terminate(); this.rejectPending?.() }
}
