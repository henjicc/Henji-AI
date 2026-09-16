import type {
  ImageEditDocumentReferenceV3,
  ImageEditDocumentRepositoryV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts'
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'

export type ImageEditPersistenceV3Status =
  | { kind: 'idle'; reference: ImageEditDocumentReferenceV3 }
  | { kind: 'saving'; reference: ImageEditDocumentReferenceV3 }
  | { kind: 'failed'; reference: ImageEditDocumentReferenceV3; error: unknown }

export interface ImageEditPersistenceV3Options {
  repository: Pick<ImageEditDocumentRepositoryV3, 'save'>
  initialReference: ImageEditDocumentReferenceV3
  initialHistory: ImageEditCommandHistorySnapshotV3
  onStatusChange?: (status: ImageEditPersistenceV3Status) => void
}

/**
 * 文档实例的 latest-only 保存队列。文档校验、CAS 与原子落盘
 * 仍由 ImageEditorV3CommandRepository 和主进程仓库负责。
 */
export class ImageEditPersistenceV3Queue {
  private pending: ImageEditPersistenceSnapshotV3 | null = null
  private inFlight: Promise<ImageEditDocumentReferenceV3> | null = null
  private reference: ImageEditDocumentReferenceV3
  private persistedHistory: string
  private pauseToken: symbol | null = null
  private resumed: Promise<void> | null = null
  private resume: (() => void) | null = null
  private status: ImageEditPersistenceV3Status
  private readonly listeners = new Set<(status: ImageEditPersistenceV3Status) => void>()

  constructor(private readonly options: ImageEditPersistenceV3Options) {
    this.reference = options.initialReference
    this.persistedHistory = JSON.stringify(options.initialHistory)
    this.status = { kind: 'idle', reference: this.reference }
  }

  getStatus(): ImageEditPersistenceV3Status { return this.status }
  isBusy(): boolean { return Boolean(this.inFlight || this.pauseToken) }
  isDirty(): boolean { return Boolean(this.pending) }
  subscribe(listener: (status: ImageEditPersistenceV3Status) => void): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  private publish(status: ImageEditPersistenceV3Status): void {
    this.status = status
    this.options.onStatusChange?.(status)
    for (const listener of this.listeners) listener(status)
  }

  getReference(): ImageEditDocumentReferenceV3 {
    return this.reference
  }

  /** 物化不增加文档版本；只接纳当前已保存版本的权威预览，不覆盖更新中的内容。 */
  confirmProjectionReference(reference: ImageEditDocumentReferenceV3): void {
    if (reference.documentId !== this.reference.documentId || reference.revision !== this.reference.revision) {
      throw new Error('图片文档预览确认与已保存版本不一致')
    }
    this.reference = reference
    this.publish({ kind: 'idle', reference })
  }

  enqueue(snapshot: ImageEditPersistenceSnapshotV3): void {
    const { document, history } = snapshot
    if (document.id !== this.reference.documentId) {
      throw new Error('图片编辑保存队列不能切换文档')
    }
    if (history.documentId !== document.id || history.headRevision !== document.revision) {
      throw new Error('图片编辑历史头与文档不匹配')
    }
    const historyJson = JSON.stringify(history)
    if (document.revision < this.reference.revision
      || (document.revision === this.reference.revision && historyJson === this.persistedHistory)) return
    if (!this.pending || document.revision >= this.pending.document.revision) this.pending = snapshot
  }

  /** 暂停自动写入；同一文档不允许两个业务批次交错。 */
  pause(): { flush: () => Promise<ImageEditDocumentReferenceV3>; release: () => void } {
    if (this.pauseToken) throw new Error('图片编辑正在确认另一组修改，请等待完成后重试')
    const token = Symbol('image-edit-persistence-batch')
    this.pauseToken = token
    this.resumed = new Promise<void>((resolve) => { this.resume = resolve })
    return {
      flush: () => this.flush(token),
      release: () => {
        if (this.pauseToken !== token) return
        this.pauseToken = null
        this.resume?.()
        this.resume = null
        this.resumed = null
      },
    }
  }

  async flush(token?: symbol): Promise<ImageEditDocumentReferenceV3> {
    if (this.pauseToken && this.pauseToken !== token) {
      await this.resumed
      return this.flush()
    }
    if (this.inFlight) {
      await this.inFlight
      return this.pending ? this.flush(token) : this.reference
    }
    this.inFlight = this.drain(token)
    try {
      return await this.inFlight
    } finally {
      this.inFlight = null
    }
  }

  private async drain(token?: symbol): Promise<ImageEditDocumentReferenceV3> {
    while (this.pending && (!this.pauseToken || this.pauseToken === token)) {
      const snapshot = this.pending
      const { document, history } = snapshot
      this.pending = null
      const historyJson = JSON.stringify(history)
      if (document.revision < this.reference.revision
        || (document.revision === this.reference.revision && historyJson === this.persistedHistory)) continue
      this.publish({ kind: 'saving', reference: this.reference })
      try {
        this.reference = await this.options.repository.save(document, {
          expectedRevision: this.reference.revision,
          previewRef: null,
          history,
        })
        this.persistedHistory = historyJson
        this.publish({ kind: 'idle', reference: this.reference })
      } catch (error) {
        const queuedAfterFailure = this.pending as ImageEditPersistenceSnapshotV3 | null
        if (!queuedAfterFailure || document.revision > queuedAfterFailure.document.revision) {
          this.pending = snapshot
        }
        this.publish({ kind: 'failed', reference: this.reference, error })
        throw error
      }
    }
    return this.reference
  }
}
