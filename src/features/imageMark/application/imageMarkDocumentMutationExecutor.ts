import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
} from '@/core/application-control'
import { applyWriterTable, fieldWriterTable, propertyOperations, writableProperties } from '@/core/application-control'
import { createLogger } from '@/core/logging'
import { imageEditDocumentToMarkDoc, replaceMarkDocInImageEditDocument, type ImageEditDocument, type ImageMarkDoc } from '@/core/imageEdit'
import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore'

import { IMAGE_MARK_DOCUMENT_FIELDS as FIELDS, IMAGE_MARK_ENTITY_TYPES } from './imageMarkFields'
import { documentRevision, requireSessionDocument } from './imageMarkSessionAccess'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.imageMark.document_mutation')

const UNDO_PREFIX = 'image-mark-document-undo:'

const WRITERS = fieldWriterTable(FIELDS)

interface UndoPayload {
  sessionId: string
  previousDocument: ImageEditDocument
}

/**
 * image_mark.document 属性写入执行器（6.2）：三条属性（旋转/镜像/裁剪）共享同一份写入表，
 * 落地都走 imageEditSessionStore.commitDocument——draft 就是当前会话文档快照本身
 * （fieldDefinition.ts "直写型" 的先例），不需要单独的 patch 类型。
 */
export class ImageMarkDocumentMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly entityType = IMAGE_MARK_ENTITY_TYPES.document
  readonly writableProperties = writableProperties(WRITERS)
  readonly propertyOperations = propertyOperations(WRITERS)

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const sessionId = step.target.id
    const previousDocument = requireSessionDocument(sessionId)
    const draft: ImageMarkDoc = structuredClone(imageEditDocumentToMarkDoc(previousDocument))

    await applyWriterTable(WRITERS, draft, step.mutations)

    const nextDocument = replaceMarkDocInImageEditDocument(previousDocument, draft)
    useImageEditSessionStore.getState().commitDocument(sessionId, nextDocument)

    const revision = documentRevision(nextDocument)
    logger.info('标注文档属性写入完成', {
      event: 'image_mark.document_mutation.apply.completed',
      sessionId,
      properties: step.mutations.map((mutation) => mutation.propertyId),
    })

    return {
      status: 'completed',
      resultingRevisions: { image_mark: revision },
      directRefs: [{ kind: this.entityType, id: sessionId, revision }],
      evidence: step.mutations.map((mutation) => ({
        kind: 'property_value' as const,
        target: { kind: this.entityType, id: sessionId, revision },
        fact: `标注文档属性 ${mutation.propertyId} 已更新。`,
        data: mutation.value ?? null,
        capturedAt: new Date().toISOString(),
      })),
      undoToken: `${UNDO_PREFIX}${JSON.stringify({ sessionId, previousDocument } satisfies UndoPayload)}`,
    }
  }

  async compensate(_step: MutationStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    if (!undoToken.startsWith(UNDO_PREFIX)) throw new Error('IMAGE_MARK_DOCUMENT_UNDO_INVALID')
    const { sessionId, previousDocument } = JSON.parse(undoToken.slice(UNDO_PREFIX.length)) as UndoPayload
    useImageEditSessionStore.getState().commitDocument(sessionId, previousDocument)
    const revision = documentRevision(previousDocument)
    return {
      status: 'completed',
      resultingRevisions: { image_mark: revision },
      directRefs: [{ kind: this.entityType, id: sessionId, revision }],
      evidence: [{
        kind: 'entity_state',
        target: { kind: this.entityType, id: sessionId, revision },
        fact: '标注文档属性写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }
}
