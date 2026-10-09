import { runImageEditPersistedOperationV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOperations'
import type {
  ApplicationCollectionExecutor,
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationPlannedStep,
  ApplicationExecutionContext,
} from '@/core/application-control'
import { createLogger } from '@/core/logging'
import {
  createMarkId,
  sanitizeMarkItem,
} from '@/core/imageEdit'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import { requireImageEditDocumentInstanceV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { findImageEditV3LiveLayer, imageEditV3AnnotationRef, isImageEditV3Ref, splitImageEditV3AnnotationRef, splitImageEditV3LayerRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'

import { IMAGE_MARK_ENTITY_TYPES } from './imageMarkFields'
import { imageMarkRevision } from './imageMarkSessionAccess'

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>

const logger = createLogger('features.imageMark.annotation_collection')

const V3_UNDO_PREFIX = 'image-mark-v3-annotation-collection-undo:'

interface V3UndoPayload {
  documentId: string
  refs: Array<{ kind: string; id: string }>
  commandIdsNewestFirst: string[]
}

function property(properties: Record<string, unknown>, suffix: string): unknown {
  return properties[`${IMAGE_MARK_ENTITY_TYPES.annotation}.${suffix}`]
}

/** 标注写入、撤销和补偿均委托 V3 持久命令。 */
export class ImageMarkAnnotationCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = IMAGE_MARK_ENTITY_TYPES.annotation
  readonly effectContract = { direct: [], cascades: [] }

  async apply(step: CollectionStep, context?: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    if (step.parent.id.startsWith('v3:')) {
      const documentId = decodeURIComponent(step.parent.id.slice(3).split(':')[0])
      return runImageEditPersistedOperationV3(documentId, context, () => this.applyInMemory(step))
    }
    return this.applyInMemory(step)
  }

  private async applyInMemory(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    if (step.parent.kind !== 'image_edit.layer' || !isImageEditV3Ref(step.parent)) throw new Error('NOT_FOUND')
    return this.applyV3(step)
  }

  async compensate(step: CollectionStep, result: ApplicationCompletedStepResult, context?: ApplicationExecutionContext): Promise<ApplicationEvidence[]> {
    if (result.undoToken?.startsWith(V3_UNDO_PREFIX)) {
      const payload = JSON.parse(result.undoToken.slice(V3_UNDO_PREFIX.length)) as V3UndoPayload
      return runImageEditPersistedOperationV3(payload.documentId, context, () => this.compensateInMemory(step, result))
    }
    return this.compensateInMemory(step, result)
  }

  private async compensateInMemory(_step: CollectionStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    if (result.undoToken.startsWith(V3_UNDO_PREFIX)) {
      const payload = JSON.parse(result.undoToken.slice(V3_UNDO_PREFIX.length)) as V3UndoPayload
      const { bus } = requireImageEditDocumentInstanceV3(payload.documentId)
      if (!bus.rollbackCommands(payload.commandIdsNewestFirst)) {
        throw new Error('IMAGE_MARK_V3_ANNOTATION_COLLECTION_ROLLBACK_EMPTY')
      }
      return [{
        kind: 'entity_state',
        fact: 'V3 标注集合写入已回滚，失败命令未进入重做历史。',
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
      if (!bus.undoCommands(payload.commandIdsNewestFirst)) {
        throw new Error('IMAGE_MARK_V3_ANNOTATION_COLLECTION_UNDO_EMPTY')
      }
      const revision = imageMarkRevision()
      return {
        status: 'completed',
        resultingRevisions: { image_mark: revision, image_edit: revision },
        directRefs: payload.refs.map((ref) => ({ ...ref, revision })),
        evidence: [{
          kind: 'entity_state',
          fact: 'V3 标注集合写入已通过同一命令历史撤销。',
          capturedAt: new Date().toISOString(),
        }],
      }
    }
    throw new Error('IMAGE_MARK_V3_ANNOTATION_UNDO_INVALID')
  }

  private async applyV3(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    const { documentId, layerId } = splitImageEditV3LayerRef(step.parent)
    const { bus } = requireImageEditDocumentInstanceV3(documentId)
    const initial = findImageEditV3LiveLayer(bus.getSnapshot().document, layerId)
    if (!initial || initial.layer.type !== 'annotation') throw new Error('NOT_FOUND')
    const refs: Array<{ kind: string; id: string }> = []
    const commandIds: string[] = []
    try {
      if (step.operation.kind === 'create') {
        for (const entry of step.operation.items) {
          const type = property(entry.properties, 'type')
          const data = property(entry.properties, 'data')
          if (typeof type !== 'string') throw new Error('INVALID_INPUT：创建标注必须提供 type。')
          if (typeof data !== 'object' || data === null || Array.isArray(data)) {
            throw new Error('INVALID_INPUT：创建标注必须提供 data 对象。')
          }
          const annotation = sanitizeMarkItem({ ...data, id: createMarkId(), type })
          if (!annotation) throw new Error(`INVALID_INPUT：type=${type} 与 data 不匹配或缺少必填字段。`)
          const location = findImageEditV3LiveLayer(bus.getSnapshot().document, layerId)
          if (!location || location.layer.type !== 'annotation') throw new Error('NOT_FOUND')
          const commandId = createImageEditIdV3('assistant-command')
          bus.dispatch({
            commandId,
            expectedRevision: bus.getSnapshot().document.revision,
            type: 'annotation.add',
            layerId,
            index: location.layer.annotations.length,
            annotation,
          })
          commandIds.push(commandId)
          refs.push(imageEditV3AnnotationRef(documentId, layerId, annotation.id))
        }
      } else {
        for (const target of step.operation.targets) {
          const identity = splitImageEditV3AnnotationRef(target)
          if (identity.documentId !== documentId || identity.layerId !== layerId) {
            throw new Error('NOT_FOUND：目标标注不属于指定 V3 标注图层。')
          }
          const commandId = createImageEditIdV3('assistant-command')
          bus.dispatch({
            commandId,
            expectedRevision: bus.getSnapshot().document.revision,
            type: 'annotation.delete',
            layerId,
            annotationId: identity.annotationId,
          })
          commandIds.push(commandId)
          refs.push(target)
        }
      }
    } catch (error) {
      if (commandIds.length > 0) bus.rollbackCommands([...commandIds].reverse())
      throw error
    }
    const revision = imageMarkRevision()
    logger.info('V3 标注集合写入完成', {
      event: 'image_mark.v3_annotation_collection.apply.completed',
      documentId,
      layerId,
      operation: step.operation.kind,
      count: refs.length,
    })
    return {
      status: 'completed',
      resultingRevisions: { image_mark: revision, image_edit: revision },
      directRefs: refs.map((ref) => ({ ...ref, revision })),
      evidence: [{
        kind: 'operation_result',
        target: { ...step.parent, revision },
        fact: `已在 V3 标注图层中${step.operation.kind === 'create' ? '新建' : '删除'} ${refs.length} 条标注。`,
        capturedAt: new Date().toISOString(),
      }],
      undoToken: `${V3_UNDO_PREFIX}${JSON.stringify({
        documentId,
        refs,
        commandIdsNewestFirst: [...commandIds].reverse(),
      } satisfies V3UndoPayload)}`,
    }
  }
}
