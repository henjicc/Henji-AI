import type { ImageEditDocumentReferenceV3, ImageEditPersistenceSnapshotV3 } from '@/core/imageEdit/v3/serviceContracts'
import type { ApplicationPersistenceBatch, ApplicationPersistenceParticipant, ApplicationPersistenceReceipt } from '@/core/application-control/execution/persistence'
import type { ApplicationCascadeEffectDeclaration } from '@/core/application-control/execution/types'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { createLogger } from '@/core/logging'
import type { ApplicationExecutionContext } from '@/core/application-control/execution/types'
import type { ApplicationPersistenceCorrelation } from '@/core/application-control/persistenceCorrelation'
import { v4 as uuidv4 } from 'uuid'

const logger = createLogger('features.imageEdit.v3.persistence_owner')

export interface ImageEditPersistenceQueuePortV3 {
  enqueue(snapshot: ImageEditPersistenceSnapshotV3, operationCorrelation?: ApplicationPersistenceCorrelation): void
  flush(): Promise<ImageEditDocumentReferenceV3>
  getReference(): ImageEditDocumentReferenceV3
  confirmProjectionReference(reference: ImageEditDocumentReferenceV3): void
  pause(): { flush(): Promise<ImageEditDocumentReferenceV3>; release(): void }
}

export interface ImageEditPersistenceProjectionV3 extends ApplicationPersistenceReceipt {
  reference: ImageEditDocumentReferenceV3
}

export interface ImageEditPersistenceHostV3 {
  /** 每次登记时捕获具体队列，旧登记不得读取新宿主的 ref.current。 */
  getQueue(): ImageEditPersistenceQueuePortV3 | null
  confirmProjection?: (reference: ImageEditDocumentReferenceV3, context?: { operationId?: string }) => Promise<ImageEditPersistenceProjectionV3 | void>
  projection?: {
    effects: readonly ApplicationCascadeEffectDeclaration[]
    requiredPermissions: readonly string[]
    currentRevisions: () => Record<string, number>
  }
}

export class ImageEditPersistenceOwnerV3 implements ApplicationPersistenceParticipant {
  readonly key: string
  private active = true
  private confirming: Promise<ImageEditDocumentReferenceV3> | null = null
  private batch: ReturnType<ImageEditPersistenceQueuePortV3['pause']> | null = null
  private batchConfirmation: {
    promise: Promise<ImageEditDocumentReferenceV3>
    resolve: (reference: ImageEditDocumentReferenceV3) => void
    reject: (error: unknown) => void
  } | null = null
  private expectedDocument: ImageEditPersistenceSnapshotV3['document'] | null = null
  private projectionNeeded = false
  private projectedDocument: ImageEditPersistenceSnapshotV3['document'] | null = null
  private projectedHistory: string | null = null
  private receipt: ApplicationPersistenceReceipt | undefined
  private operationCorrelation: ApplicationPersistenceCorrelation | undefined
  private pendingDocumentOperation: { snapshot: ImageEditPersistenceSnapshotV3; correlation: ApplicationPersistenceCorrelation } | undefined
  private pendingProjectionOperation: { reference: ImageEditDocumentReferenceV3; operationId: string } | undefined

  constructor(
    readonly documentId: string,
    private readonly queue: ImageEditPersistenceQueuePortV3,
    private readonly snapshot: () => ImageEditPersistenceSnapshotV3,
    private readonly confirmProjection?: ImageEditPersistenceHostV3['confirmProjection'],
    readonly projection?: ImageEditPersistenceHostV3['projection'],
  ) {
    if (queue.getReference().documentId !== documentId) throw new Error('图片编辑保存宿主与文档不匹配')
    this.key = `image-edit-document:${documentId}`
  }

  dispose(): void { this.active = false }
  get persistenceEffects() { return this.projection?.effects }
  getConfirmationReceipt(): ApplicationPersistenceReceipt | undefined { return this.receipt }
  ownsQueue(queue: ImageEditPersistenceQueuePortV3): boolean { return this.queue === queue }

  assertCurrent(): void {
    if (!this.active) throw new Error('图片编辑会话已关闭或替换，请重新打开原文档后重试保存')
    if (this.expectedDocument && this.snapshot().document !== this.expectedDocument) {
      throw new Error('图片编辑期间出现新的编辑，请保留当前内容并重新读取后规划')
    }
  }

  acceptCurrent(): void { if (this.batch) this.expectedDocument = this.snapshot().document }

  begin(context?: ApplicationExecutionContext): ApplicationPersistenceBatch {
    this.assertCurrent()
    if (this.confirming) throw new Error('REVISION_CONFLICT:图片正在确认保存，请稍后重新读取并执行本次操作')
    if (this.batch) throw new Error('图片编辑正在确认另一组修改，请等待完成后重试')
    const batch = this.queue.pause()
    this.batch = batch
    let resolve!: (reference: ImageEditDocumentReferenceV3) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<ImageEditDocumentReferenceV3>((done, failed) => { resolve = done; reject = failed })
    void promise.catch(() => undefined)
    this.batchConfirmation = { promise, resolve, reject }
    this.expectedDocument = this.snapshot().document
    const documentRef = { kind: 'image_edit.document', id: `v3:${encodeURIComponent(this.documentId)}` }
    this.operationCorrelation = context?.operationId ? { operationId: context.operationId, boundaryId: uuidv4(), targets: [documentRef] } : undefined
    return {
      confirm: async (targets) => {
        if (this.operationCorrelation && targets) {
          const changed = targets.filter((ref) => (ref.kind.startsWith('image_edit.') || ref.kind === 'image_mark.annotation')
            && (ref.id === documentRef.id || ref.id.startsWith(`${documentRef.id}:`)))
          this.operationCorrelation.targets = changed.length ? [...changed] : [documentRef]
        }
        try { resolve(await this.performConfirmation(true)); return this.receipt }
        catch (error) { reject(error); throw error }
      },
      release: () => {
        if (this.batch !== batch) return
        this.expectedDocument = null
        this.operationCorrelation = undefined
        this.batch = null
        this.batchConfirmation = null
        reject(new Error('图片编辑批次未完成，请重试保存当前内容'))
        batch.release()
      },
    }
  }

  /** UI 重试和助手恢复只确认最新快照，从不 dispatch / undo 业务命令。 */
  confirm(includeProjection = this.projectionNeeded): Promise<ImageEditDocumentReferenceV3> {
    if (this.batchConfirmation) return this.batchConfirmation.promise
    return this.performConfirmation(includeProjection)
  }

  private performConfirmation(includeProjection: boolean): Promise<ImageEditDocumentReferenceV3> {
    this.projectionNeeded ||= includeProjection && Boolean(this.confirmProjection)
      && (this.projectedDocument !== this.snapshot().document
        || this.projectedHistory !== JSON.stringify(this.snapshot().history))
    if (this.confirming) return this.confirming
    this.receipt = undefined
    const promise = this.drainConfirmation()
    this.confirming = promise
    void promise.finally(() => { if (this.confirming === promise) this.confirming = null }).catch(() => undefined)
    return promise
  }

  private async drainConfirmation(): Promise<ImageEditDocumentReferenceV3> {
    let stage: 'document' | 'projection' = 'document'
    try {
      if (!this.active) throw new Error('原编辑会话已关闭，不能借用新会话确认保存')
      for (;;) {
        const snapshot = this.snapshot()
        const pendingDocument = this.pendingDocumentOperation
        const operationCorrelation = this.operationCorrelation ?? (pendingDocument?.snapshot.document === snapshot.document
          && JSON.stringify(pendingDocument.snapshot.history) === JSON.stringify(snapshot.history) ? pendingDocument.correlation : undefined)
        if (operationCorrelation) this.pendingDocumentOperation = { snapshot, correlation: operationCorrelation }
        this.queue.enqueue(snapshot, operationCorrelation)
        const reference = await (this.batch ? this.batch.flush() : this.queue.flush())
        if (operationCorrelation) {
          if (this.pendingDocumentOperation?.correlation === operationCorrelation) this.pendingDocumentOperation = undefined
          if (this.confirmProjection) this.pendingProjectionOperation = { reference, operationId: operationCorrelation.operationId }
        }
        if (!this.active) throw new Error('保存期间原编辑会话已关闭，请重新打开原文档核对')
        if (this.snapshot().document !== snapshot.document) {
          if (operationCorrelation) throw new Error('保存期间出现新的编辑，请核对原操作结果')
          continue
        }
        if (this.projectionNeeded && this.confirmProjection) {
          stage = 'projection'
          const pending = this.pendingProjectionOperation
          const projectionContext = pending?.reference.documentId === reference.documentId && pending.reference.revision === reference.revision
            ? { operationId: pending.operationId } : undefined
          const receipt = await this.confirmProjection(reference, projectionContext)
          if (projectionContext && this.pendingProjectionOperation === pending) this.pendingProjectionOperation = undefined
          if (receipt) {
            this.receipt = { effects: receipt.effects, resultingRevisions: receipt.resultingRevisions }
            this.queue.confirmProjectionReference(receipt.reference)
          }
          if (!this.active) throw new Error('节点同步期间编辑会话已被替换，请重新读取结果')
          if (this.snapshot().document !== snapshot.document) { stage = 'document'; continue }
          this.projectionNeeded = false
          this.projectedDocument = snapshot.document
          this.projectedHistory = JSON.stringify(snapshot.history)
        }
        logger.info('图片编辑持久化确认完成', {
          event: 'image_edit.v3.persistence.confirm.completed',
          context: { documentId: this.documentId, revision: reference.revision },
        })
        return this.queue.getReference()
      }
    } catch (cause) {
      logger.error('图片编辑持久化确认失败', cause, {
        event: 'image_edit.v3.persistence.confirm.failed', context: { documentId: this.documentId, stage },
      })
      throw new ApplicationPersistenceFailure(
        '当前图片编辑内容已保留，但保存未确认。请重试保存，不要重复修改、新增、删除或撤销操作。',
        { memoryState: 'modified', persistenceState: 'unconfirmed', stage,
          recovery: { capabilityId: 'retry_image_edit_document_save',
            target: { kind: 'image_edit.document', id: `v3:${encodeURIComponent(this.documentId)}` }, replayMutation: false } },
        cause,
        cause instanceof ApplicationPersistenceFailure ? cause.receipt : this.receipt,
      )
    }
  }
}
