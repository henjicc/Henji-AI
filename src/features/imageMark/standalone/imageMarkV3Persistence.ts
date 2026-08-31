import type {
  ImageEditDocumentReferenceV3,
  ImageEditDocumentRepositoryV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts'
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'

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
  private pending: ImageEditPersistenceSnapshotV3 | null = null
  private inFlight: Promise<ImageEditDocumentReferenceV3> | null = null
  private reference: ImageEditDocumentReferenceV3
  private persistedHistory: string

  constructor(private readonly options: ImageMarkV3PersistenceOptions) {
    this.reference = options.initialReference
    this.persistedHistory = JSON.stringify(options.initialHistory)
  }

  getReference(): ImageEditDocumentReferenceV3 {
    return this.reference
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

  async flush(): Promise<ImageEditDocumentReferenceV3> {
    if (this.inFlight) {
      await this.inFlight
      return this.pending ? this.flush() : this.reference
    }
    this.inFlight = this.drain()
    try {
      return await this.inFlight
    } finally {
      this.inFlight = null
    }
  }

  private async drain(): Promise<ImageEditDocumentReferenceV3> {
    while (this.pending) {
      const snapshot = this.pending
      const { document, history } = snapshot
      this.pending = null
      const historyJson = JSON.stringify(history)
      if (document.revision < this.reference.revision
        || (document.revision === this.reference.revision && historyJson === this.persistedHistory)) continue
      this.options.onStatusChange?.({ kind: 'saving', reference: this.reference })
      try {
        this.reference = await this.options.repository.save(document, {
          expectedRevision: this.reference.revision,
          previewRef: null,
          history,
        })
        this.persistedHistory = historyJson
        this.options.onStatusChange?.({ kind: 'idle', reference: this.reference })
      } catch (error) {
        const queuedAfterFailure = this.pending as ImageEditPersistenceSnapshotV3 | null
        if (!queuedAfterFailure || document.revision > queuedAfterFailure.document.revision) {
          this.pending = snapshot
        }
        this.options.onStatusChange?.({ kind: 'failed', reference: this.reference, error })
        throw error
      }
    }
    return this.reference
  }
}
