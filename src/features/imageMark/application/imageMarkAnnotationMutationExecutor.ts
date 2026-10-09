import { assertImageEditPersistenceCurrentV3, runImageEditPersistedOperationV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOperations'
import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
  ApplicationExecutionContext,
} from '@/core/application-control'
import { applyWriterTable, fieldWriterTable, propertyOperations, writableProperties } from '@/core/application-control'
import { createLogger } from '@/core/logging'
import type { MarkItem } from '@/core/imageEdit'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import { requireImageEditDocumentInstanceV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { findImageEditV3LiveLayer, isImageEditV3Ref, splitImageEditV3AnnotationRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'

import { IMAGE_MARK_ANNOTATION_FIELDS as FIELDS, IMAGE_MARK_ENTITY_TYPES } from './imageMarkFields'
import { imageMarkRevision } from './imageMarkSessionAccess'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.imageMark.annotation_mutation')

const V3_UNDO_PREFIX = 'image-mark-v3-annotation-undo:'

const WRITERS = fieldWriterTable(FIELDS)

interface V3UndoPayload {
  documentId: string
  targetId: string
  commandId: string
}

/** 标注写入、撤销和补偿均委托 V3 持久命令。 */
export class ImageMarkAnnotationMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly entityType = IMAGE_MARK_ENTITY_TYPES.annotation
  readonly writableProperties = writableProperties(WRITERS)
  readonly propertyOperations = propertyOperations(WRITERS)

  async apply(step: MutationStep, context?: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    if (step.target.id.startsWith('v3:')) {
      const documentId = decodeURIComponent(step.target.id.slice(3).split(':')[0])
      return runImageEditPersistedOperationV3(documentId, context, () => this.applyInMemory(step))
    }
    return this.applyInMemory(step)
  }

  private async applyInMemory(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    if (!isImageEditV3Ref(step.target)) throw new Error('NOT_FOUND')
    return this.applyV3(step)
  }

  async compensate(step: MutationStep, result: ApplicationCompletedStepResult, context?: ApplicationExecutionContext): Promise<ApplicationEvidence[]> {
    if (result.undoToken?.startsWith(V3_UNDO_PREFIX)) {
      const payload = JSON.parse(result.undoToken.slice(V3_UNDO_PREFIX.length)) as V3UndoPayload
      return runImageEditPersistedOperationV3(payload.documentId, context, () => this.compensateInMemory(step, result))
    }
    return this.compensateInMemory(step, result)
  }

  private async compensateInMemory(_step: MutationStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    if (result.undoToken.startsWith(V3_UNDO_PREFIX)) {
      const payload = JSON.parse(result.undoToken.slice(V3_UNDO_PREFIX.length)) as V3UndoPayload
      const { bus } = requireImageEditDocumentInstanceV3(payload.documentId)
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

  async undo(undoToken: string, context?: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    if (undoToken.startsWith(V3_UNDO_PREFIX)) {
      const payload = JSON.parse(undoToken.slice(V3_UNDO_PREFIX.length)) as V3UndoPayload
      return runImageEditPersistedOperationV3(payload.documentId, context, () => this.undoInMemory(undoToken))
    }
    return this.undoInMemory(undoToken)
  }

  private async undoInMemory(undoToken: string): Promise<ApplicationCompletedStepResult> {
    if (undoToken.startsWith(V3_UNDO_PREFIX)) {
      const payload = JSON.parse(undoToken.slice(V3_UNDO_PREFIX.length)) as V3UndoPayload
      const { bus } = requireImageEditDocumentInstanceV3(payload.documentId)
      if (!bus.undoCommands([payload.commandId])) throw new Error('IMAGE_MARK_V3_ANNOTATION_UNDO_EMPTY')
      const revision = imageMarkRevision()
      return {
        status: 'completed',
        resultingRevisions: { image_mark: revision, image_edit: revision },
        directRefs: [{ kind: this.entityType, id: payload.targetId, revision }],
        evidence: [{
          kind: 'entity_state',
          target: { kind: this.entityType, id: payload.targetId, revision },
          fact: 'V3 标注属性写入已通过同一命令历史撤销。',
          capturedAt: new Date().toISOString(),
        }],
      }
    }
    throw new Error('IMAGE_MARK_V3_ANNOTATION_UNDO_INVALID')
  }

  private async applyV3(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const { documentId, layerId, annotationId } = splitImageEditV3AnnotationRef(step.target)
    const { bus } = requireImageEditDocumentInstanceV3(documentId)
    const location = findImageEditV3LiveLayer(bus.getSnapshot().document, layerId)
    if (!location || location.layer.type !== 'annotation') throw new Error('NOT_FOUND')
    const item = location.layer.annotations.find((candidate) => candidate.id === annotationId)
    if (!item) throw new Error('NOT_FOUND')
    const draft: MarkItem = structuredClone(item)
    await applyWriterTable(WRITERS, draft, step.mutations)
    assertImageEditPersistenceCurrentV3(documentId)
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
      resultingRevisions: { image_mark: revision, image_edit: revision },
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
