import { toFetchableMediaUrl } from '@/services/imageSource'
import type { ImageEditorV3Controller } from '../editor/types'
import { ImageEditorPreviewClientV3 } from '../execution/imageEditorPreviewClientV3'
import { acquireImageEditorSessionResourceBudgetV3 } from '../execution/imageEditorSessionResourceBudgetV3'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditMemoryLease } from '@/core/imageEdit/v3/resourceBudget'

/** 缩略图复用正式合成 Worker，串行调度；有界缓存只淘汰派生图片，不裁图层或历史。 */
export class ImageEditThumbnailsV3 {
  private readonly client: ImageEditorPreviewClientV3
  private readonly cache = new Map<string, { url: string; lease: ImageEditMemoryLease }>()
  private readonly budgetLease
  private tail: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private readonly controller: Pick<ImageEditorV3Controller, 'sessionId' | 'historyPort' | 'historyResourceDescriptors'>) {
    const consumerId = `editor-thumbnails:${crypto.randomUUID()}`
    this.budgetLease = acquireImageEditorSessionResourceBudgetV3(controller.sessionId, { consumerId })
    this.client = new ImageEditorPreviewClientV3({ sessionId: controller.sessionId,
      coalescingKey: consumerId, purpose: 'thumbnail', priority: 0, pyramidPrewarmEnabled: false })
  }

  read(position: number, key: string, signal: AbortSignal): Promise<string> {
    return this.readSource(() => {
      if (!this.controller.historyPort) throw new Error('缩略图会话已关闭')
      return this.controller.historyPort.readHistoryDocument(position, signal)
    }, key, signal)
  }

  readDocument(document: ImageEditDocumentV3, key: string, signal: AbortSignal): Promise<string> {
    return this.readSource(() => Promise.resolve(document), key, signal)
  }

  private readSource(resolveDocument: () => Promise<ImageEditDocumentV3>, key: string, signal: AbortSignal): Promise<string> {
    const cached = this.cache.get(key)
    if (cached) return Promise.resolve(cached.url)
    const work = this.tail.catch(() => undefined).then(async () => {
      signal.throwIfAborted()
      if (this.disposed) throw new Error('缩略图会话已关闭')
      const existing = this.cache.get(key)
      if (existing) return existing.url
      const document = await resolveDocument()
      signal.throwIfAborted()
      const result = await this.client.render({ document, quality: 'stable', maxDimension: 64,
        resourceDescriptors: this.controller.historyResourceDescriptors ?? [] })
      let decoded: ImageBitmap | null = null
      try {
        signal.throwIfAborted()
        if (this.disposed) throw new Error('缩略图会话已关闭')
        const bitmap = result.kind === 'bitmap' ? result.bitmap
          : (decoded = await createImageBitmap(await (await fetch(toFetchableMediaUrl(result.url), { signal })).blob()))
        const canvas = window.document.createElement('canvas')
        canvas.width = result.width; canvas.height = result.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('缩略图无法绘制')
        context.drawImage(bitmap, 0, 0)
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('缩略图无法生成')), 'image/png'))
        signal.throwIfAborted()
        if (this.disposed) throw new Error('缩略图会话已关闭')
        const bytes = blob.size + result.width * result.height * 4
        while (this.cache.size && (this.cache.size >= 64 || !this.budgetLease.budget.admission('cpu-cache', bytes).admitted)) {
          const oldest = this.cache.keys().next().value as string
          const entry = this.cache.get(oldest)!
          URL.revokeObjectURL(entry.url); entry.lease.release(); this.cache.delete(oldest)
        }
        const lease = this.budgetLease.budget.acquire('cpu-cache', bytes)
        if (!lease) throw new Error('暂时没有足够内存生成缩略图')
        const url = URL.createObjectURL(blob)
        this.cache.set(key, { url, lease })
        return url
      } finally { decoded?.close(); result.release() }
    })
    this.tail = work
    return work
  }

  dispose(): void {
    this.disposed = true
    this.client.dispose()
    for (const entry of this.cache.values()) { URL.revokeObjectURL(entry.url); entry.lease.release() }
    this.cache.clear()
    this.budgetLease.release()
  }
}
