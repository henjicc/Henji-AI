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
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import {
  findImageEditV3LiveLayer,
  isImageEditV3Ref,
  requireImageEditV3LiveSession,
  splitImageEditV3AnnotationRef,
} from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'

import { IMAGE_MARK_ANNOTATION_FIELDS as FIELDS, IMAGE_MARK_ENTITY_TYPES } from './imageMarkFields'
import { annotationRef, imageMarkRevision, requireSessionDocument, splitAnnotationRef } from './imageMarkSessionAccess'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.imageMark.annotation_mutation')

const UNDO_PREFIX = 'image-mark-annotation-undo:'
const V3_UNDO_PREFIX = 'image-mark-v3-annotation-undo:'

const WRITERS = fieldWriterTable(FIELDS)

interface UndoPayload {
  sessionId: string
  annotationId: string
  previousDocument: ImageEditDocument
}

interface V3UndoPayload {
  documentId: string
  targetId: string
  commandId: string
}

/**
 * image_mark.annotation 属性写入执行器（6.2）：只有 data 一条真正可写（type 创建后不可变）。
 * draft 是目标标注的克隆，applyWriterTable 跑完写入表后整体替换回 items 数组里的同一位置，
 * 再走 imageEditSessionStore.commitDocument 落地。
 */
export class ImageMarkAnnotationMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly entityType = IMAGE_MARK_ENTITY_TYPES.annotation
  readonly writableProperties = writableProperties(WRITERS)
  readonly propertyOperations = propertyOperations(WRITERS)

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    if (isImageEditV3Ref(step.target)) return this.applyV3(step)
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

    const revision = imageMarkRevision()
    logger.info('标注属性写入完成', {
      event: 'image_mark.annotation_mutation.apply.completed',
      sessionId,
      annotationId,
      properties: step.mutations.map((mutation) => mutation.propertyId),
    })

    return {
      status: 'completed',
      resultingRevisions: { image_mark: revision },
      directRefs: [{ ...annotationRef(sessionId, draft), revision }],
      evidence: step.mutations.map((mutation) => ({
        kind: 'property_value' as const,
        target: { ...annotationRef(sessionId, draft), revision },
        fact: `标注属性 ${mutation.propertyId} 已更新。`,
        data: mutation.value ?? null,
        capturedAt: new Date().toISOString(),
      })),
      undoToken: `${UNDO_PREFIX}${JSON.stringify({ sessionId, annotationId, previousDocument } satisfies UndoPayload)}`,
    }
  }

  async compensate(_step: MutationStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    if (result.undoToken.startsWith(V3_UNDO_PREFIX)) {
      const payload = JSON.parse(result.undoToken.slice(V3_UNDO_PREFIX.length)) as V3UndoPayload
      const { bus } = requireImageEditV3LiveSession(payload.documentId)
      if (!bus.rollbackCommands([payload.commandId])) {
        throw new Error('IMAGE_MARK_V3_ANNOTATION_ROLLBACK_EMPTY')
      }
      const revision = imageMarkRevision()
      return [{
        kind: 'entity_state',
        target: { kind: this.entityType, id: payload.targetId, revision },
        fact: 'V3 标注属性写入已回滚，失败命令未进入重做历史。',
        capturedAt: new Date().toISOString(),
      }]
    }
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    if (undoToken.startsWith(V3_UNDO_PREFIX)) {
      const payload = JSON.parse(undoToken.slice(V3_UNDO_PREFIX.length)) as V3UndoPayload
      const { bus } = requireImageEditV3LiveSession(payload.documentId)
      if (!bus.undoCommands([payload.commandId])) throw new Error('IMAGE_MARK_V3_ANNOTATION_UNDO_EMPTY')
      const revision = imageMarkRevision()
      return {
        status: 'completed',
        resultingRevisions: { image_mark: revision },
        directRefs: [{ kind: this.entityType, id: payload.targetId, revision }],
        evidence: [{
          kind: 'entity_state',
          target: { kind: this.entityType, id: payload.targetId, revision },
          fact: 'V3 标注属性写入已通过同一命令历史撤销。',
          capturedAt: new Date().toISOString(),
        }],
      }
    }
    if (!undoToken.startsWith(UNDO_PREFIX)) throw new Error('IMAGE_MARK_ANNOTATION_UNDO_INVALID')
    const { sessionId, annotationId, previousDocument } = JSON.parse(undoToken.slice(UNDO_PREFIX.length)) as UndoPayload
    useImageEditSessionStore.getState().commitDocument(sessionId, previousDocument)
    const revision = imageMarkRevision()
    return {
      status: 'completed',
      resultingRevisions: { image_mark: revision },
      directRefs: [{ kind: this.entityType, id: `${sessionId}:${annotationId}`, revision }],
      evidence: [{
        kind: 'entity_state',
        target: { kind: IMAGE_MARK_ENTITY_TYPES.document, id: sessionId, revision },
        fact: '标注属性写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }

  private async applyV3(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const { documentId, layerId, annotationId } = splitImageEditV3AnnotationRef(step.target)
    const { bus } = requireImageEditV3LiveSession(documentId)
    const location = findImageEditV3LiveLayer(bus.getSnapshot().document, layerId)
    if (!location || location.layer.type !== 'annotation') throw new Error('NOT_FOUND')
    const item = location.layer.annotations.find((candidate) => candidate.id === annotationId)
    if (!item) throw new Error('NOT_FOUND')
    const draft: MarkItem = structuredClone(item)
    await applyWriterTable(WRITERS, draft, step.mutations)
    const commandId = createImageEditIdV3('assistant-command')
    bus.dispatch({
      commandId,
      expectedRevision: bus.getSnapshot().document.revision,
      type: 'annotation.update',
      layerId,
      annotationId,
      annotation: draft,
    })
    const revision = imageMarkRevision()
    logger.info('V3 标注属性写入完成', {
      event: 'image_mark.v3_annotation_mutation.apply.completed',
      documentId,
      layerId,
      annotationId,
      properties: step.mutations.map((mutation) => mutation.propertyId),
    })
    return {
      status: 'completed',
      resultingRevisions: { image_mark: revision },
      directRefs: [{ ...step.target, revision }],
      evidence: step.mutations.map((mutation) => ({
        kind: 'property_value' as const,
        target: { ...step.target, revision },
        fact: `V3 标注属性 ${mutation.propertyId} 已更新。`,
        data: mutation.value ?? null,
        capturedAt: new Date().toISOString(),
      })),
      undoToken: `${V3_UNDO_PREFIX}${JSON.stringify({
        documentId,
        targetId: step.target.id,
        commandId,
      } satisfies V3UndoPayload)}`,
    }
  }
}
