import type { ImageEditDocumentV3, ImageEditRenderPlanNode, ImageEditRect } from '@/core/imageEdit/v3'
import { prepareVectorDocumentFonts } from '@/services/vectorContent/fonts'
import { rasterizeImageEditorViewportVectorImageV3 } from './viewportCompositePixelsV3'
import type { FontPayload } from '@/platform/fonts'

export interface VectorRasterRequestV3 { id: number; value: unknown; region: ImageEditRect; mip: number; revision: number; geometry: ImageEditDocumentV3['geometry']; fonts?: FontPayload[] }
export type VectorRasterResponseV3 = { id: number; width: number; height: number; pixels: ArrayBuffer } | { id: number; error: string }

/** GPU 标注纹理和命中检测复用原生 Canvas 内核，计算放在专用 Worker。 */
export class ImageEditorVectorRasterClientV3 {
  private worker: Worker | undefined
  private sequence = 0
  private disposed = false
  private sentFonts: string | undefined
  private readonly pending = new Map<number, { resolve: (image: ImageData) => void; reject: (error: Error) => void; release: () => void }>()
  private readonly fonts = new WeakMap<ImageEditDocumentV3, Promise<FontPayload[]>>()
  /** 场景打开时启动专用 Worker，首次文字提交无需再等待模块启动。 */
  warm(): void { if (!this.disposed && typeof Worker !== 'undefined') this.ensureWorker() }
  private ensureWorker(): void {
    if (this.worker) return
    this.worker = new Worker(new URL('./vectorRaster.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<VectorRasterResponseV3>) => {
      const reply = event.data, pending = this.pending.get(reply.id)
      if (!pending) return
      this.pending.delete(reply.id); pending.release()
      if ('error' in reply) { this.sentFonts = undefined; pending.reject(new Error(reply.error)) }
      else pending.resolve(new ImageData(new Uint8ClampedArray(reply.pixels), reply.width, reply.height))
    }
    this.worker.onerror = event => { this.fail(new Error(event.message || '矢量渲染 Worker 失败')); this.worker?.terminate(); this.worker = undefined; this.sentFonts = undefined }
  }
  async rasterize(node: Pick<ImageEditRenderPlanNode, 'parameters'>, document: ImageEditDocumentV3, region: ImageEditRect, mip: number, signal: AbortSignal): Promise<ImageData> {
    signal.throwIfAborted()
    if (this.disposed) throw new Error('矢量渲染器已关闭')
    if (typeof Worker === 'undefined') return rasterizeImageEditorViewportVectorImageV3(node as ImageEditRenderPlanNode, document, region, mip, signal)
    this.ensureWorker()
    let fonts = this.fonts.get(document)
    if (!fonts) { fonts = prepareVectorDocumentFonts(document); this.fonts.set(document, fonts); void fonts.catch(() => this.fonts.delete(document)) }
    const payloads = await fonts
    signal.throwIfAborted()
    if (this.disposed) throw new Error('矢量渲染器已关闭')
    this.ensureWorker()
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        const pending = this.pending.get(id); if (!pending) return
        this.pending.delete(id); pending.release(); reject(new DOMException('矢量渲染已取消', 'AbortError'))
        if (this.pending.size === 0) { this.worker?.terminate(); this.worker = undefined; this.sentFonts = undefined }
      }
      this.pending.set(id, { resolve, reject, release: () => signal.removeEventListener('abort', abort) })
      signal.addEventListener('abort', abort, { once: true })
      try {
        const signature = JSON.stringify(payloads.map(payload => payload.face.id).sort())
        this.worker!.postMessage({ id, value: node.parameters, region, mip, revision: document.revision, geometry: document.geometry,
          ...(signature !== this.sentFonts ? { fonts: payloads } : {}) } satisfies VectorRasterRequestV3)
        this.sentFonts = signature
      }
      catch (error) { this.pending.delete(id); signal.removeEventListener('abort', abort); reject(error) }
    })
  }
  dispose(): void { this.disposed = true; this.worker?.terminate(); this.worker = undefined; this.fail(new DOMException('矢量渲染器已关闭', 'AbortError')) }
  private fail(error: Error): void { for (const pending of this.pending.values()) { pending.release(); pending.reject(error) } this.pending.clear() }
}
