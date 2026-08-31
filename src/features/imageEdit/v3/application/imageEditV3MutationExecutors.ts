import {
  applyWriterTable,
  fieldWriterTable,
  propertyOperations,
  type ApplicationCompletedStepResult,
  type ApplicationEvidence,
  type ApplicationExecutionContext,
  type ApplicationMutationExecutor,
  type ApplicationPlannedStep,
  writableProperties,
} from '@/core/application-control'
import { createLogger } from '@/core/logging'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditCommandV3 } from '@/core/imageEdit/v3/commandTypes'
import {
  cloneImageEditMaskReferenceV3,
  type ImageEditJsonObjectV3,
} from '@/core/imageEdit/v3/layerTypes'

import {
  IMAGE_EDIT_V3_GROUP_FIELDS,
  IMAGE_EDIT_V3_LAYER_FIELDS,
  IMAGE_EDIT_V3_MASK_FIELDS,
  type ImageEditV3LayerMutationDraft,
  type ImageEditV3MaskMutationDraft,
} from './imageEditV3Fields'
import {
  findImageEditV3LiveLayer,
  getImageEditV3LiveRevision,
  requireImageEditV3LiveSession,
  splitImageEditV3DocumentRef,
  splitImageEditV3LayerRef,
} from './imageEditLiveSessionRegistry'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.imageEdit.v3.application_mutation')
const UNDO_PREFIX = 'image-edit-v3-undo:'

interface UndoPayload {
  entityType: 'image_edit.layer' | 'image_edit.group' | 'image_edit.mask'
  documentId: string
  targetId: string
  commandIdsNewestFirst: string[]
}

function encodeUndo(payload: UndoPayload): string {
  return `${UNDO_PREFIX}${JSON.stringify(payload)}`
}

function decodeUndo(token: string): UndoPayload {
  if (!token.startsWith(UNDO_PREFIX)) throw new Error('IMAGE_EDIT_V3_UNDO_INVALID')
  const value = JSON.parse(token.slice(UNDO_PREFIX.length)) as Partial<UndoPayload>
  if (
    !['image_edit.layer', 'image_edit.group', 'image_edit.mask'].includes(value.entityType ?? '')
    || typeof value.documentId !== 'string'
    || typeof value.targetId !== 'string'
    || !Array.isArray(value.commandIdsNewestFirst)
    || value.commandIdsNewestFirst.some((item) => typeof item !== 'string')
  ) {
    throw new Error('IMAGE_EDIT_V3_UNDO_INVALID')
  }
  return value as UndoPayload
}

function completed(
  step: MutationStep,
  documentId: string,
  commandIds: string[],
): ApplicationCompletedStepResult {
  const revision = getImageEditV3LiveRevision()
  return {
    status: 'completed',
    resultingRevisions: { image_edit: revision },
    directRefs: [{ ...step.target, revision }],
    evidence: step.mutations.map((mutation) => ({
      kind: 'property_value' as const,
      target: { ...step.target, revision },
      fact: `图片编辑属性 ${mutation.propertyId} 已通过当前 V3 命令总线更新。`,
      data: mutation.value ?? null,
      capturedAt: new Date().toISOString(),
    })),
    undoToken: encodeUndo({
      entityType: step.entityType as UndoPayload['entityType'],
      documentId,
      targetId: step.target.id,
      commandIdsNewestFirst: [...commandIds].reverse(),
    }),
  }
}

async function undoPayload(payload: UndoPayload): Promise<ApplicationCompletedStepResult> {
  const { bus } = requireImageEditV3LiveSession(payload.documentId)
  if (!bus.undoCommands(payload.commandIdsNewestFirst)) throw new Error('IMAGE_EDIT_V3_UNDO_EMPTY')
  const revision = getImageEditV3LiveRevision()
  return {
    status: 'completed',
    resultingRevisions: { image_edit: revision },
    directRefs: [{ kind: payload.entityType, id: payload.targetId, revision }],
    evidence: [{
      kind: 'entity_state',
      target: { kind: payload.entityType, id: payload.targetId, revision },
      fact: '图片编辑 V3 属性写入已通过命令历史撤销。',
      capturedAt: new Date().toISOString(),
    }],
  }
}

async function rollbackPayload(payload: UndoPayload): Promise<ApplicationCompletedStepResult> {
  const { bus } = requireImageEditV3LiveSession(payload.documentId)
  if (!bus.rollbackCommands(payload.commandIdsNewestFirst)) throw new Error('IMAGE_EDIT_V3_ROLLBACK_EMPTY')
  const revision = getImageEditV3LiveRevision()
  return {
    status: 'completed',
    resultingRevisions: { image_edit: revision },
    directRefs: [{ kind: payload.entityType, id: payload.targetId, revision }],
    evidence: [{
      kind: 'entity_state',
      target: { kind: payload.entityType, id: payload.targetId, revision },
      fact: '图片编辑 V3 属性写入已回滚，失败命令未进入重做历史。',
      capturedAt: new Date().toISOString(),
    }],
  }
}

abstract class ImageEditV3MutationExecutorBase implements ApplicationMutationExecutor {
  abstract readonly entityType: UndoPayload['entityType']
  abstract readonly writableProperties: ReadonlySet<string>
  abstract readonly propertyOperations: ApplicationMutationExecutor['propertyOperations']
  readonly effectContract = { direct: [], cascades: [] }

  abstract createCommands(step: MutationStep): Promise<{ documentId: string; commands: ImageEditCommandV3[] }>

  async apply(step: MutationStep, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    if (context.signal?.aborted) throw new Error('CANCELLED')
    logger.info('图片编辑 V3 属性写入开始', {
      event: 'image_edit.v3.application_mutation.apply.start',
      requestId: context.requestId,
      entityType: step.entityType,
      targetId: step.target.id,
    })
    const { documentId, commands } = await this.createCommands(step)
    const { bus } = requireImageEditV3LiveSession(documentId)
    const applied: string[] = []
    try {
      for (const command of commands) {
        if (context.signal?.aborted) throw new Error('CANCELLED')
        bus.dispatch({ ...command, expectedRevision: bus.getSnapshot().document.revision })
        applied.push(command.commandId)
      }
      const result = completed(step, documentId, applied)
      logger.info('图片编辑 V3 属性写入完成', {
        event: 'image_edit.v3.application_mutation.apply.completed',
        requestId: context.requestId,
        entityType: step.entityType,
        targetId: step.target.id,
        revision: result.resultingRevisions.image_edit,
      })
      return result
    } catch (error) {
      if (applied.length > 0) bus.rollbackCommands([...applied].reverse())
      logger.error('图片编辑 V3 属性写入失败', {
        event: 'image_edit.v3.application_mutation.apply.failed',
        requestId: context.requestId,
        entityType: step.entityType,
        targetId: step.target.id,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async applyAtomic(
    steps: MutationStep[],
    context: ApplicationExecutionContext,
  ): Promise<ApplicationCompletedStepResult[]> {
    const results: ApplicationCompletedStepResult[] = []
    try {
      for (const step of steps) results.push(await this.apply(step, context))
      return results
    } catch (error) {
      for (let index = results.length - 1; index >= 0; index -= 1) {
        const token = results[index]?.undoToken
        if (token) await rollbackPayload(decodeUndo(token))
      }
      throw error
    }
  }

  async compensate(
    _step: MutationStep,
    result: ApplicationCompletedStepResult,
  ): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await rollbackPayload(decodeUndo(result.undoToken))).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    return undoPayload(decodeUndo(undoToken))
  }
}

const LAYER_WRITERS = fieldWriterTable(IMAGE_EDIT_V3_LAYER_FIELDS)
const GROUP_WRITERS = fieldWriterTable(IMAGE_EDIT_V3_GROUP_FIELDS)
const MASK_WRITERS = fieldWriterTable(IMAGE_EDIT_V3_MASK_FIELDS)

function resolveMoveTarget(
  documentId: string,
  layerId: string,
  draft: ImageEditV3LayerMutationDraft,
): { parentId: string | null; index: number } | null {
  if (!draft.parentRef && draft.index === undefined) return null
  const { bus } = requireImageEditV3LiveSession(documentId)
  const document = bus.getSnapshot().document
  const location = findImageEditV3LiveLayer(document, layerId)
  if (!location) throw new Error('NOT_FOUND')
  let parentId = location.parentId
  if (draft.parentRef?.kind === 'image_edit.document') {
    const target = splitImageEditV3DocumentRef(draft.parentRef)
    if (target.documentId !== documentId) throw new Error('NOT_FOUND：不能跨文档移动图层。')
    parentId = null
  } else if (draft.parentRef) {
    const target = splitImageEditV3LayerRef(draft.parentRef, 'image_edit.group')
    if (target.documentId !== documentId) throw new Error('NOT_FOUND：不能跨文档移动图层。')
    const parent = findImageEditV3LiveLayer(document, target.layerId)
    if (!parent || parent.layer.type !== 'group') throw new Error('NOT_FOUND：目标图层组不存在。')
    parentId = target.layerId
  }
  const targetGroup = parentId === null ? null : findImageEditV3LiveLayer(document, parentId)
  if (parentId !== null && (!targetGroup || targetGroup.layer.type !== 'group')) {
    throw new Error('NOT_FOUND：目标图层组不存在。')
  }
  const targetLength = targetGroup?.layer.type === 'group'
    ? targetGroup.layer.children.length
    : document.layers.length
  const index = draft.index ?? (parentId === location.parentId ? location.index : targetLength)
  const finalLength = targetLength - (parentId === location.parentId ? 1 : 0)
  if (index > finalLength) {
    throw new Error(`INVALID_INPUT：index=${index} 超出目标父级的最终范围 0～${Math.max(0, finalLength)}。`)
  }
  return parentId === location.parentId && index === location.index ? null : { parentId, index }
}

function layerCommands(
  step: MutationStep,
  entityType: 'image_edit.layer' | 'image_edit.group',
  fields: typeof IMAGE_EDIT_V3_LAYER_FIELDS | typeof IMAGE_EDIT_V3_GROUP_FIELDS,
): Promise<{ documentId: string; commands: ImageEditCommandV3[] }> {
  const { documentId, layerId } = splitImageEditV3LayerRef(step.target, entityType)
  const { bus } = requireImageEditV3LiveSession(documentId)
  const location = findImageEditV3LiveLayer(bus.getSnapshot().document, layerId)
  if (!location) throw new Error('NOT_FOUND')
  if (entityType === 'image_edit.layer' && location.layer.type === 'group') throw new Error('NOT_FOUND')
  if (entityType === 'image_edit.group' && location.layer.type !== 'group') throw new Error('NOT_FOUND')
  const draft: ImageEditV3LayerMutationDraft = { commonPatch: {} }
  const writers = fieldWriterTable(fields)
  return applyWriterTable(writers, draft, step.mutations).then(() => {
    const commands: ImageEditCommandV3[] = []
    const base = (): { commandId: string; expectedRevision: number } => ({
      commandId: createImageEditIdV3('assistant-command'),
      expectedRevision: bus.getSnapshot().document.revision,
    })
    if (Object.keys(draft.commonPatch).length > 0) {
      commands.push({ ...base(), type: 'layer.update-common', layerId, patch: draft.commonPatch })
    }
    if (draft.params) {
      commands.push({
        ...base(),
        type: 'layer.update-params',
        layerId,
        params: draft.params as ImageEditJsonObjectV3,
      })
    }
    if (draft.isolated !== undefined) {
      commands.push({ ...base(), type: 'group.update-isolation', layerId, isolated: draft.isolated })
    }
    const move = resolveMoveTarget(documentId, layerId, draft)
    if (move) commands.push({ ...base(), type: 'layer.move', layerId, ...move })
    if (commands.length === 0) throw new Error('NO_STATE_CHANGE')
    return { documentId, commands }
  })
}

export class ImageEditV3LayerMutationExecutor extends ImageEditV3MutationExecutorBase {
  readonly entityType = 'image_edit.layer' as const
  readonly writableProperties = writableProperties(LAYER_WRITERS)
  readonly propertyOperations = propertyOperations(LAYER_WRITERS)

  createCommands(step: MutationStep): Promise<{ documentId: string; commands: ImageEditCommandV3[] }> {
    return layerCommands(step, this.entityType, IMAGE_EDIT_V3_LAYER_FIELDS)
  }
}

export class ImageEditV3GroupMutationExecutor extends ImageEditV3MutationExecutorBase {
  readonly entityType = 'image_edit.group' as const
  readonly writableProperties = writableProperties(GROUP_WRITERS)
  readonly propertyOperations = propertyOperations(GROUP_WRITERS)

  createCommands(step: MutationStep): Promise<{ documentId: string; commands: ImageEditCommandV3[] }> {
    return layerCommands(step, this.entityType, IMAGE_EDIT_V3_GROUP_FIELDS)
  }
}

export class ImageEditV3MaskMutationExecutor extends ImageEditV3MutationExecutorBase {
  readonly entityType = 'image_edit.mask' as const
  readonly writableProperties = writableProperties(MASK_WRITERS)
  readonly propertyOperations = propertyOperations(MASK_WRITERS)

  async createCommands(step: MutationStep): Promise<{ documentId: string; commands: ImageEditCommandV3[] }> {
    const { documentId, layerId } = splitImageEditV3LayerRef(step.target, 'image_edit.mask')
    const { bus } = requireImageEditV3LiveSession(documentId)
    const location = findImageEditV3LiveLayer(bus.getSnapshot().document, layerId)
    if (!location?.layer.mask) throw new Error('NOT_FOUND')
    const draft: ImageEditV3MaskMutationDraft = {}
    await applyWriterTable(MASK_WRITERS, draft, step.mutations)
    if (draft.inverted === undefined) throw new Error('NO_STATE_CHANGE')
    return {
      documentId,
      commands: [{
        commandId: createImageEditIdV3('assistant-command'),
        expectedRevision: bus.getSnapshot().document.revision,
        type: 'layer.set-mask',
        layerId,
        mask: {
          ...cloneImageEditMaskReferenceV3(location.layer.mask),
          inverted: draft.inverted,
        },
      }],
    }
  }
}
