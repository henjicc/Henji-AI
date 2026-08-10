import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
} from '@/core/application-control'
import { applyWriterTable, fieldWriterTable, propertyOperations, writableProperties } from '@/core/application-control'
import { createLogger } from '@/core/logging'
import { imageEditDocumentToMarkDoc, replaceMarkDocInImageEditDocument, type ImageEditDocument, type MarkItem } from '@/core/imageEdit'
import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore'

import { IMAGE_MARK_ANNOTATION_FIELDS as FIELDS, IMAGE_MARK_ENTITY_TYPES } from './imageMarkFields'
import { annotationRef, documentRevision, requireSessionDocument, splitAnnotationRef } from './imageMarkSessionAccess'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.imageMark.annotation_mutation')

const UNDO_PREFIX = 'image-mark-annotation-undo:'

const WRITERS = fieldWriterTable(FIELDS)

interface UndoPayload {
  sessionId: string
  previousDocument: ImageEditDocument
}

/**
 * image_mark.annotation 属性写入执行器（6.2）：只有 data 一条真正可写（type 创建后不可变）。
 * draft 是目标标注的克隆，applyWriterTable 跑完写入表后整体替换回 items 数组里的同一位置，
 * 再走 imageEditSessionStore.commitDocument 落地。
 */
export class ImageMarkAnnotationMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = IMAGE_MARK_ENTITY_TYPES.annotation
  readonly writableProperties = writableProperties(WRITERS)
  readonly propertyOperations = propertyOperations(WRITERS)

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const { sessionId, annotationId } = splitAnnotationRef(step.target)
    const previousDocument = requireSessionDocument(sessionId)
    const markDoc = imageEditDocumentToMarkDoc(previousDocument)
    const index = markDoc.items.findIndex((item) => item.id === annotationId)
    if (index < 0) throw new Error('NOT_FOUND')

    const draft: MarkItem = structuredClone(markDoc.items[index])
    await applyWriterTable(WRITERS, draft, step.mutations)

    const nextItems = [...markDoc.items]
    nextItems[index] = draft
    const nextDocument = replaceMarkDocInImageEditDocument(previousDocument, { ...markDoc, items: nextItems })
    useImageEditSessionStore.getState().commitDocument(sessionId, nextDocument)

    const revision = documentRevision(nextDocument)
    logger.info('标注属性写入完成', {
      event: 'image_mark.annotation_mutation.apply.completed',
      sessionId,
      annotationId,
      properties: step.mutations.map((mutation) => mutation.propertyId),
    })

    return {
      status: 'completed',
      resultingRevisions: { image_mark: revision },
      producedRefs: [{ ...annotationRef(sessionId, draft), revision }],
      evidence: step.mutations.map((mutation) => ({
        kind: 'property_value' as const,
        target: { ...annotationRef(sessionId, draft), revision },
        fact: `标注属性 ${mutation.propertyId} 已更新。`,
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
    if (!undoToken.startsWith(UNDO_PREFIX)) throw new Error('IMAGE_MARK_ANNOTATION_UNDO_INVALID')
    const { sessionId, previousDocument } = JSON.parse(undoToken.slice(UNDO_PREFIX.length)) as UndoPayload
    useImageEditSessionStore.getState().commitDocument(sessionId, previousDocument)
    const revision = documentRevision(previousDocument)
    return {
      status: 'completed',
      resultingRevisions: { image_mark: revision },
      producedRefs: [{ kind: IMAGE_MARK_ENTITY_TYPES.document, id: sessionId, revision }],
      evidence: [{
        kind: 'entity_state',
        target: { kind: IMAGE_MARK_ENTITY_TYPES.document, id: sessionId, revision },
        fact: '标注属性写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }
}
