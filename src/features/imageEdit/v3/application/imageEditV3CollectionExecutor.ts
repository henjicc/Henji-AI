import type {
  ApplicationCollectionExecutor,
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationExecutionContext,
  ApplicationPlannedStep,
  ApplicationRef,
  JsonValue,
} from '@/core/application-control'
import {
  createImageEditAdjustmentLayerV3,
  createImageEditAnnotationLayerV3,
  createImageEditEffectLayerV3,
  createImageEditGroupLayerV3,
  createImageEditIdV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import { listCreatableImageEditOperationIdsV3 } from '@/core/imageEdit/v3/operationCatalog'
import type { ImageEditCommandV3 } from '@/core/imageEdit/v3/commandTypes'
import type { ImageEditJsonObjectV3, ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import { createLogger } from '@/core/logging'

import {
  findImageEditV3LiveLayer,
  getImageEditV3LiveRevision,
  imageEditV3GroupRef,
  imageEditV3LayerRef,
  requireImageEditV3LiveSession,
  splitImageEditV3DocumentRef,
  splitImageEditV3LayerRef,
} from './imageEditLiveSessionRegistry'

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>
type CollectionEntityType = 'image_edit.layer' | 'image_edit.group'

const logger = createLogger('features.imageEdit.v3.application_collection')
const UNDO_PREFIX = 'image-edit-v3-collection-undo:'
const EFFECT_IDS = new Set(listCreatableImageEditOperationIdsV3('effect'))
const ADJUSTMENT_IDS = new Set(listCreatableImageEditOperationIdsV3('adjustment'))

interface UndoPayload {
  entityType: CollectionEntityType
  documentId: string
  refs: ApplicationRef[]
  commandIdsNewestFirst: string[]
}

function fullProperty(properties: Record<string, JsonValue>, entityType: string, suffix: string): JsonValue | undefined {
  return properties[`${entityType}.${suffix}`]
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`INVALID_INPUT：${label} 必须是非空字符串。`)
  }
  return value.trim()
}

function requiredParams(value: JsonValue | undefined): ImageEditJsonObjectV3 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_INPUT：params 必须是 JSON 对象。')
  }
  return structuredClone(value) as ImageEditJsonObjectV3
}

function createLayer(properties: Record<string, JsonValue>): ImageEditLayerV3 {
  const entityType = 'image_edit.layer'
  const name = requiredString(fullProperty(properties, entityType, 'name'), 'name')
  const type = requiredString(fullProperty(properties, entityType, 'type'), 'type')
  const definitionId = fullProperty(properties, entityType, 'definition_id')
  const params = fullProperty(properties, entityType, 'params')
  const id = createImageEditIdV3('layer')
  if (type === 'raster') {
    if (definitionId !== null || params !== null) throw new Error('INVALID_INPUT：栅格图层的 definition_id 与 params 必须为 null。')
    return createImageEditRasterLayerV3(id, name)
  }
  if (type === 'annotation') {
    if (definitionId !== null || params !== null) throw new Error('INVALID_INPUT：标注图层的 definition_id 与 params 必须为 null。')
    return createImageEditAnnotationLayerV3(id, name)
  }
  if (type === 'effect') {
    const effectId = requiredString(definitionId, 'definition_id')
    if (!EFFECT_IDS.has(effectId)) {
      throw new Error(`INVALID_INPUT：不支持的效果 ${effectId}；可用 ${[...EFFECT_IDS].join('、')}。`)
    }
    return createImageEditEffectLayerV3(id, name, effectId, requiredParams(params))
  }
  if (type === 'adjustment') {
    const adjustmentId = requiredString(definitionId, 'definition_id')
    if (!ADJUSTMENT_IDS.has(adjustmentId)) {
      throw new Error(`INVALID_INPUT：不支持的调整 ${adjustmentId}；可用 ${[...ADJUSTMENT_IDS].join('、')}。`)
    }
    return createImageEditAdjustmentLayerV3(id, name, adjustmentId, requiredParams(params))
  }
  throw new Error('INVALID_INPUT：type 只能是 raster、annotation、effect 或 adjustment。')
}

function createGroup(properties: Record<string, JsonValue>): ImageEditLayerV3 {
  const name = requiredString(fullProperty(properties, 'image_edit.group', 'name'), 'name')
  const isolated = fullProperty(properties, 'image_edit.group', 'isolated')
  if (isolated !== undefined && typeof isolated !== 'boolean') {
    throw new Error('INVALID_INPUT：isolated 必须是布尔值。')
  }
  return {
    ...createImageEditGroupLayerV3(createImageEditIdV3('layer'), name),
    ...(typeof isolated === 'boolean' ? { isolated } : {}),
  }
}

function parentIdentity(parent: ApplicationRef): { documentId: string; parentId: string | null } {
  if (parent.kind === 'image_edit.document') {
    return { ...splitImageEditV3DocumentRef(parent), parentId: null }
  }
  const { documentId, layerId } = splitImageEditV3LayerRef(parent, 'image_edit.group')
  return { documentId, parentId: layerId }
}

function containerLength(documentId: string, parentId: string | null): number {
  const document = requireImageEditV3LiveSession(documentId).bus.getSnapshot().document
  if (parentId === null) return document.layers.length
  const location = findImageEditV3LiveLayer(document, parentId)
  if (!location || location.layer.type !== 'group') throw new Error('NOT_FOUND')
  return location.layer.children.length
}

function encodeUndo(payload: UndoPayload): string {
  return `${UNDO_PREFIX}${JSON.stringify(payload)}`
}

function decodeUndo(token: string): UndoPayload {
  if (!token.startsWith(UNDO_PREFIX)) throw new Error('IMAGE_EDIT_V3_COLLECTION_UNDO_INVALID')
  const value = JSON.parse(token.slice(UNDO_PREFIX.length)) as Partial<UndoPayload>
  if (
    !['image_edit.layer', 'image_edit.group'].includes(value.entityType ?? '')
    || typeof value.documentId !== 'string'
    || !Array.isArray(value.refs)
    || !Array.isArray(value.commandIdsNewestFirst)
  ) {
    throw new Error('IMAGE_EDIT_V3_COLLECTION_UNDO_INVALID')
  }
  return value as UndoPayload
}

async function undoPayload(payload: UndoPayload): Promise<ApplicationCompletedStepResult> {
  const { bus } = requireImageEditV3LiveSession(payload.documentId)
  if (!bus.undoCommands(payload.commandIdsNewestFirst)) throw new Error('IMAGE_EDIT_V3_COLLECTION_UNDO_EMPTY')
  const revision = getImageEditV3LiveRevision()
  return {
    status: 'completed',
    resultingRevisions: { image_edit: revision },
    directRefs: payload.refs.map((ref) => ({ ...ref, revision })),
    evidence: [{
      kind: 'entity_state',
      fact: '图片编辑 V3 图层集合写入已通过命令历史撤销。',
      capturedAt: new Date().toISOString(),
    }],
  }
}

async function rollbackPayload(payload: UndoPayload): Promise<ApplicationCompletedStepResult> {
  const { bus } = requireImageEditV3LiveSession(payload.documentId)
  if (!bus.rollbackCommands(payload.commandIdsNewestFirst)) {
    throw new Error('IMAGE_EDIT_V3_COLLECTION_ROLLBACK_EMPTY')
  }
  const revision = getImageEditV3LiveRevision()
  return {
    status: 'completed',
    resultingRevisions: { image_edit: revision },
    directRefs: payload.refs.map((ref) => ({ ...ref, revision })),
    evidence: [{
      kind: 'entity_state',
      fact: '图片编辑 V3 图层集合写入已回滚，失败命令未进入重做历史。',
      capturedAt: new Date().toISOString(),
    }],
  }
}

export class ImageEditV3CollectionExecutor implements ApplicationCollectionExecutor {
  readonly effectContract = { direct: [], cascades: [] }

  constructor(readonly entityType: CollectionEntityType) {}

  async apply(step: CollectionStep, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    if (context.signal?.aborted) throw new Error('CANCELLED')
    const { documentId, parentId } = parentIdentity(step.parent)
    const { bus } = requireImageEditV3LiveSession(documentId)
    const commandIds: string[] = []
    const refs: ApplicationRef[] = []
    logger.info('图片编辑 V3 图层集合写入开始', {
      event: 'image_edit.v3.application_collection.apply.start',
      requestId: context.requestId,
      entityType: this.entityType,
      documentId,
      operation: step.operation.kind,
    })
    try {
      if (step.operation.kind === 'create') {
        for (const item of step.operation.items) {
          if (context.signal?.aborted) throw new Error('CANCELLED')
          const layer = this.entityType === 'image_edit.group'
            ? createGroup(item.properties)
            : createLayer(item.properties)
          const command: ImageEditCommandV3 = {
            commandId: createImageEditIdV3('assistant-command'),
            expectedRevision: bus.getSnapshot().document.revision,
            type: 'layer.add',
            parentId,
            index: containerLength(documentId, parentId),
            layer,
          }
          bus.dispatch(command)
          commandIds.push(command.commandId)
          refs.push(layer.type === 'group'
            ? imageEditV3GroupRef(documentId, layer.id)
            : imageEditV3LayerRef(documentId, layer.id))
        }
      } else {
        for (const target of step.operation.targets) {
          if (context.signal?.aborted) throw new Error('CANCELLED')
          const expectedKind = this.entityType
          const targetIdentity = splitImageEditV3LayerRef(target, expectedKind)
          if (targetIdentity.documentId !== documentId) {
            throw new Error('NOT_FOUND：目标图层不属于指定父文档。')
          }
          const location = findImageEditV3LiveLayer(bus.getSnapshot().document, targetIdentity.layerId)
          if (!location || location.parentId !== parentId) {
            throw new Error('NOT_FOUND：目标图层不在指定父级中。')
          }
          if (this.entityType === 'image_edit.group' && location.layer.type !== 'group') throw new Error('NOT_FOUND')
          if (this.entityType === 'image_edit.layer' && location.layer.type === 'group') throw new Error('NOT_FOUND')
          const command: ImageEditCommandV3 = {
            commandId: createImageEditIdV3('assistant-command'),
            expectedRevision: bus.getSnapshot().document.revision,
            type: 'layer.delete',
            layerId: targetIdentity.layerId,
          }
          bus.dispatch(command)
          commandIds.push(command.commandId)
          refs.push(target)
        }
      }
      const revision = getImageEditV3LiveRevision()
      logger.info('图片编辑 V3 图层集合写入完成', {
        event: 'image_edit.v3.application_collection.apply.completed',
        requestId: context.requestId,
        entityType: this.entityType,
        documentId,
        operation: step.operation.kind,
        count: refs.length,
        revision,
      })
      return {
        status: 'completed',
        resultingRevisions: { image_edit: revision },
        directRefs: refs.map((ref) => ({ ...ref, revision })),
        evidence: [{
          kind: 'operation_result',
          target: { ...step.parent, revision },
          fact: `已通过当前 V3 命令总线${step.operation.kind === 'create' ? '创建' : '删除'} ${refs.length} 个图层实体。`,
          capturedAt: new Date().toISOString(),
        }],
        undoToken: encodeUndo({
          entityType: this.entityType,
          documentId,
          refs,
          commandIdsNewestFirst: [...commandIds].reverse(),
        }),
      }
    } catch (error) {
      if (commandIds.length > 0) bus.rollbackCommands([...commandIds].reverse())
      logger.error('图片编辑 V3 图层集合写入失败', {
        event: 'image_edit.v3.application_collection.apply.failed',
        requestId: context.requestId,
        entityType: this.entityType,
        documentId,
        operation: step.operation.kind,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async compensate(
    _step: CollectionStep,
    result: ApplicationCompletedStepResult,
  ): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await rollbackPayload(decodeUndo(result.undoToken))).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    return undoPayload(decodeUndo(undoToken))
  }
}
