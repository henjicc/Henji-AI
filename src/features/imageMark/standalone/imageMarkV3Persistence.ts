import type {
  ImageEditDocumentReferenceV3,
  ImageEditDocumentRepositoryV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts'
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'
import type { ApplicationPersistenceCorrelation } from '@/core/application-control/persistenceCorrelation'

interface PendingSave {
  snapshot: ImageEditPersistenceSnapshotV3
  operationCorrelation?: ApplicationPersistenceCorrelation
}

export type ImageMarkV3PersistenceStatus =
  | { kind: 'idle'; reference: ImageEditDocumentReferenceV3 }
  | { kind: 'saving'; reference: ImageEditDocumentReferenceV3 }
  | { kind: 'failed'; reference: ImageEditDocumentReferenceV3; error: unknown }

interface ImageMarkV3PersistenceOptions {
  repository: Pick<ImageEditDocumentRepositoryV3, 'save'>
  initialReference: ImageEditDocumentReferenceV3
  initialHistory: ImageEditCommandHistorySnapshotV3
  onStatusChange?: (status: ImageMarkV3PersistenceStatus) => void
}

/**
 * 工具箱宿主的 latest-only 保存队列。它只编排宿主生命周期，文档校验、CAS 与原子落盘
 * 仍由 ImageEditorV3CommandRepository 和主进程仓库负责。
 */
export class ImageMarkV3PersistenceQueue {
  private pending: PendingSave[] = []
  private inFlight: Promise<ImageEditDocumentReferenceV3> | null = null
  private reference: ImageEditDocumentReferenceV3
  private persistedHistory: string
  private pauseToken: symbol | null = null
  private resumed: Promise<void> | null = null
  private resume: (() => void) | null = null

  constructor(private readonly options: ImageMarkV3PersistenceOptions) {
    this.reference = options.initialReference
    this.persistedHistory = JSON.stringify(options.initialHistory)
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
    this.options.onStatusChange?.({ kind: 'idle', reference })
  }

  enqueue(snapshot: ImageEditPersistenceSnapshotV3, operationCorrelation?: ApplicationPersistenceCorrelation): void {
    const { document, history } = snapshot
    if (document.id !== this.reference.documentId) {
      throw new Error('图片编辑保存队列不能切换文档')
    }
    if (history.documentId !== document.id || history.headRevision !== document.revision) {
      throw new Error('图片编辑历史头与文档不匹配')
    }
    const historyJson = JSON.stringify(history)
    if (!operationCorrelation && (document.revision < this.reference.revision
      || (document.revision === this.reference.revision && historyJson === this.persistedHistory))) return
    const existing = operationCorrelation && this.pending.find((item) => item.operationCorrelation?.operationId === operationCorrelation.operationId
      && item.operationCorrelation.boundaryId === operationCorrelation.boundaryId)
    if (existing) {
      if (JSON.stringify(existing.snapshot) !== JSON.stringify(snapshot)) throw new Error('原保存关联不能绑定新的图片修改')
      return
    }
    const last = this.pending.at(-1)
    if (last && !last.operationCorrelation && document.revision >= last.snapshot.document.revision) this.pending.pop()
    if (!last || operationCorrelation || document.revision >= last.snapshot.document.revision) this.pending.push({ snapshot, operationCorrelation })
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
      return this.pending.length ? this.flush(token) : this.reference
    }
    this.inFlight = this.drain(token)
    try {
      return await this.inFlight
    } finally {
      this.inFlight = null
    }
  }

  private async drain(token?: symbol): Promise<ImageEditDocumentReferenceV3> {
    while (this.pending.length && (!this.pauseToken || this.pauseToken === token)) {
      const pending = this.pending.shift()!
      const { snapshot, operationCorrelation } = pending
      const { document, history } = snapshot
      const historyJson = JSON.stringify(history)
      if (!operationCorrelation && (document.revision < this.reference.revision
        || (document.revision === this.reference.revision && historyJson === this.persistedHistory))) continue
      this.options.onStatusChange?.({ kind: 'saving', reference: this.reference })
      try {
        if (document.revision < this.reference.revision) throw new Error('原操作保存版本已过期，请核对原文档，不要重新执行修改')
        this.reference = await this.options.repository.save(document, {
          expectedRevision: this.reference.revision,
          previewRef: null,
          history,
          ...(operationCorrelation ? { operationCorrelation } : {}),
        })
        this.persistedHistory = historyJson
        this.options.onStatusChange?.({ kind: 'idle', reference: this.reference })
      } catch (error) {
        const queuedAfterFailure = this.pending.at(0)
        if (operationCorrelation || !queuedAfterFailure || document.revision > queuedAfterFailure.snapshot.document.revision) this.pending.unshift(pending)
        this.options.onStatusChange?.({ kind: 'failed', reference: this.reference, error })
        throw error
      }
    }
    return this.reference
  }
}
