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
  IMAGE_EDIT_V3_DOCUMENT_FIELDS,
  IMAGE_EDIT_V3_GROUP_FIELDS,
  IMAGE_EDIT_V3_LAYER_FIELDS,
  IMAGE_EDIT_V3_MASK_FIELDS,
  type ImageEditV3LayerMutationDraft,
  type ImageEditV3MaskMutationDraft,
} from './imageEditV3Fields'
import { getImageEditDocumentCatalogRevisionV3, requireImageEditDocumentInstanceV3 } from './imageEditDocumentInstances'
import { collectImageEditV3LiveLayers, findImageEditV3LiveLayer, splitImageEditV3FilterRef, splitImageEditV3DocumentRef, splitImageEditV3LayerRef } from './imageEditDocumentRefs'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.imageEdit.v3.application_mutation')
const UNDO_PREFIX = 'image-edit-v3-undo:'

import { assertImageEditPersistenceCurrentV3, runImageEditPersistedOperationV3 } from './imageEditPersistenceOperations'
import { ApplicationExecutionProgressFailure } from '@/core/application-control/execution/persistence'
import { IMAGE_EDIT_HISTORY_FIELDS_V3, type ImageEditHistoryMutationDraftV3 } from './imageEditHistoryFields'
import { IMAGE_EDIT_WORKFLOW_FIELDS_V3, imageEditLayerMovesSchemaV3, type ImageEditWorkflowDraftV3 } from './imageEditWorkflowFields'
import { prepareSmartContentMutationV3 } from '../smartContent/service'

interface UndoPayload {
  entityType: 'image_edit.document' | 'image_edit.layer' | 'image_edit.group' | 'image_edit.mask' | 'image_edit.layer_filter'
  documentId: string
  targetId: string
  commandIdsNewestFirst: string[]
  historyJump?: { before: number; after: number; keys: string[] }
}

function historyKeys(documentId: string): string[] {
  const { bus } = requireImageEditDocumentInstanceV3(documentId)
  const keys: string[] = []
  for (let offset = 0; offset <= bus.getHistoryView().total; offset += 64) {
    for (const row of bus.readHistoryPage(offset)) keys.push(row.key)
  }
  return keys
}

function assertHistoryJumpCurrent(payload: UndoPayload): void {
  if (!payload.historyJump) return
  const { bus } = requireImageEditDocumentInstanceV3(payload.documentId)
  if (bus.getHistoryView().position !== payload.historyJump.after
    || JSON.stringify(historyKeys(payload.documentId)) !== JSON.stringify(payload.historyJump.keys)) {
    throw new Error('历史已经继续编辑，不能撤销过期恢复操作')
  }
}

function encodeUndo(payload: UndoPayload): string {
  return `${UNDO_PREFIX}${JSON.stringify(payload)}`
}

function decodeUndo(token: string): UndoPayload {
  if (!token.startsWith(UNDO_PREFIX)) throw new Error('IMAGE_EDIT_V3_UNDO_INVALID')
  const value = JSON.parse(token.slice(UNDO_PREFIX.length)) as Partial<UndoPayload>
  if (
    !['image_edit.document', 'image_edit.layer', 'image_edit.group', 'image_edit.mask', 'image_edit.layer_filter'].includes(value.entityType ?? '')
    || typeof value.documentId !== 'string'
    || typeof value.targetId !== 'string'
    || !Array.isArray(value.commandIdsNewestFirst)
    || value.commandIdsNewestFirst.some((item) => typeof item !== 'string')
    || (value.historyJump !== undefined && (!Number.isSafeInteger(value.historyJump.before) || value.historyJump.before < 0
      || !Number.isSafeInteger(value.historyJump.after) || value.historyJump.after < 0
      || !Array.isArray(value.historyJump.keys) || value.historyJump.keys.some(key => typeof key !== 'string')))
  ) {
    throw new Error('IMAGE_EDIT_V3_UNDO_INVALID')
  }
  return value as UndoPayload
}

function completed(
  step: MutationStep,
  documentId: string,
  commandIds: string[],
  historyJump?: UndoPayload['historyJump'],
): ApplicationCompletedStepResult {
  const movesMutation = step.mutations.find(mutation => mutation.propertyId === 'image_edit.document.layer_order')
  if (movesMutation) {
    const moves = imageEditLayerMovesSchemaV3.parse(movesMutation.value)
    const actual = new Map(collectImageEditV3LiveLayers(requireImageEditDocumentInstanceV3(documentId).bus.getSnapshot().document).map(location => [location.layer.id, location]))
    if (moves.some(move => actual.get(move.layerId)?.parentId !== move.parentId || actual.get(move.layerId)?.index !== move.index)) {
      throw new Error('图层移动后位置读回与请求不符，已取消本次修改')
    }
  }
  const revision = getImageEditDocumentCatalogRevisionV3()
  return {
    status: 'completed',
    resultingRevisions: { image_edit: revision },
    directRefs: [{ ...step.target, revision }],
    evidence: step.mutations.map((mutation) => ({
      kind: 'property_value' as const,
      target: { ...step.target, revision },
      fact: `图片编辑属性 ${mutation.propertyId} 已通过当前 V3 命令总线更新并读回。`,
      data: mutation.value ?? null,
      capturedAt: new Date().toISOString(),
    })),
    undoToken: encodeUndo({
      entityType: step.entityType as UndoPayload['entityType'],
      documentId,
      targetId: step.target.id,
      commandIdsNewestFirst: [...commandIds].reverse(),
      ...(historyJump ? { historyJump } : {}),
    }),
  }
}

async function undoPayload(payload: UndoPayload): Promise<ApplicationCompletedStepResult> {
  const { bus } = requireImageEditDocumentInstanceV3(payload.documentId)
  assertHistoryJumpCurrent(payload)
  if (payload.commandIdsNewestFirst.length && !bus.undoCommands(payload.commandIdsNewestFirst)) throw new Error('IMAGE_EDIT_V3_UNDO_EMPTY')
  if (payload.historyJump) await bus.jumpToHistory(payload.historyJump.before)
  const revision = getImageEditDocumentCatalogRevisionV3()
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
  const { bus } = requireImageEditDocumentInstanceV3(payload.documentId)
  assertHistoryJumpCurrent(payload)
  if (payload.commandIdsNewestFirst.length && !bus.rollbackCommands(payload.commandIdsNewestFirst)) throw new Error('IMAGE_EDIT_V3_ROLLBACK_EMPTY')
  if (payload.historyJump) await bus.jumpToHistory(payload.historyJump.before)
  const revision = getImageEditDocumentCatalogRevisionV3()
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

function mutationDocumentIdentity(ref: import('@/core/application-control').ApplicationRef, kind: UndoPayload['entityType']): { documentId: string } {
  if (kind === 'image_edit.layer_filter') return splitImageEditV3FilterRef(ref)
  return kind === 'image_edit.document' ? splitImageEditV3DocumentRef(ref) : splitImageEditV3LayerRef(ref, kind)
}

export abstract class ImageEditV3MutationExecutorBase implements ApplicationMutationExecutor {
  abstract readonly entityType: UndoPayload['entityType']
  abstract readonly writableProperties: ReadonlySet<string>
  abstract readonly propertyOperations: ApplicationMutationExecutor['propertyOperations']
  readonly effectContract = { direct: [], cascades: [] }

  abstract createCommands(step: MutationStep, context?: ApplicationExecutionContext): Promise<{ documentId: string; commands: ImageEditCommandV3[]; historyPosition?: number; release?: () => Promise<void> }>

  async apply(step: MutationStep, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const { documentId } = mutationDocumentIdentity(step.target, this.entityType)
    return runImageEditPersistedOperationV3(documentId, context, (batchContext) => this.applyInMemory(step, batchContext!))
  }

  private async applyInMemory(step: MutationStep, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    if (context.signal?.aborted) throw new Error('CANCELLED')
    logger.info('图片编辑 V3 属性写入开始', {
      event: 'image_edit.v3.application_mutation.apply.start',
      requestId: context.requestId,
      entityType: step.entityType,
      targetId: step.target.id,
    })
    const { documentId, commands, historyPosition, release } = await this.createCommands(step, context)
    const { bus } = requireImageEditDocumentInstanceV3(documentId)
    const applied: string[] = []
    const historyBefore = bus.getHistoryView().position
    let historyChanged = false
    try {
      assertImageEditPersistenceCurrentV3(documentId)
      if (historyPosition !== undefined) historyChanged = await bus.jumpToHistory(historyPosition, { signal: context.signal })
      for (const command of commands) {
        if (context.signal?.aborted) throw new Error('CANCELLED')
        const previous = bus.getSnapshot().document
        const next = bus.dispatch({ ...command, expectedRevision: previous.revision })
        if (next !== previous) applied.push(command.commandId)
      }
      const result = completed(step, documentId, applied, historyChanged ? { before: historyBefore, after: bus.getHistoryView().position, keys: historyKeys(documentId) } : undefined)
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
      if (historyChanged) await bus.jumpToHistory(historyBefore)
      logger.error('图片编辑 V3 属性写入失败', {
        event: 'image_edit.v3.application_mutation.apply.failed',
        requestId: context.requestId,
        entityType: step.entityType,
        targetId: step.target.id,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    } finally { await release?.() }
  }

  async applyAtomic(
    steps: MutationStep[],
    context: ApplicationExecutionContext,
  ): Promise<ApplicationCompletedStepResult[]> {
    const hasNavigation = steps.some(step => step.mutations.some(mutation => mutation.propertyId === 'image_edit.document.history_position'))
    if (hasNavigation && steps.some(step => step.mutations.some(mutation => mutation.propertyId !== 'image_edit.document.history_position'))) {
      throw new Error('恢复历史和创建新编辑请拆成独立事务；新编辑会替换重做分支，不能纳入同一原子恢复')
    }
    const { documentId } = mutationDocumentIdentity(steps[0].target, this.entityType)
    if (steps.some((step) => mutationDocumentIdentity(step.target, this.entityType).documentId !== documentId)) {
      throw new Error('图片编辑原子修改只能针对同一文档，请拆分不同文档的操作')
    }
    return runImageEditPersistedOperationV3(documentId, context, (batchContext) => this.applyAtomicInMemory(steps, batchContext!))
  }

  private async applyAtomicInMemory(steps: MutationStep[], context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult[]> {
    const results: ApplicationCompletedStepResult[] = []
    try {
      for (const step of steps) results.push(await this.apply(step, context))
      return results
    } catch (error) {
      const compensated: number[] = []
      for (let index = results.length - 1; index >= 0; index -= 1) {
        const token = results[index]?.undoToken
        try {
          if (token) await rollbackPayload(decodeUndo(token))
          compensated.push(index)
        } catch (cause) {
          throw new ApplicationExecutionProgressFailure(`${String(error)}；补偿失败：${String(cause)}`, results, compensated, error)
        }
      }
      throw new ApplicationExecutionProgressFailure(String(error), results, compensated, error)
    }
  }

  async compensate(
    _step: MutationStep,
    result: ApplicationCompletedStepResult,
    context?: ApplicationExecutionContext,
  ): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    const payload = decodeUndo(result.undoToken)
    return (await runImageEditPersistedOperationV3(payload.documentId, context, () => rollbackPayload(payload))).evidence
  }

  async undo(undoToken: string, context?: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const payload = decodeUndo(undoToken)
    return runImageEditPersistedOperationV3(payload.documentId, context, () => undoPayload(payload))
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
  const { bus } = requireImageEditDocumentInstanceV3(documentId)
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
  context?: ApplicationExecutionContext,
): Promise<{ documentId: string; commands: ImageEditCommandV3[]; release?: () => Promise<void> }> {
  const { documentId, layerId } = splitImageEditV3LayerRef(step.target, entityType)
  const { bus } = requireImageEditDocumentInstanceV3(documentId)
  const location = findImageEditV3LiveLayer(bus.getSnapshot().document, layerId)
  if (!location) throw new Error('NOT_FOUND')
  if (entityType === 'image_edit.layer' && location.layer.type === 'group') throw new Error('NOT_FOUND')
  if (entityType === 'image_edit.group' && location.layer.type !== 'group') throw new Error('NOT_FOUND')
  const draft: ImageEditV3LayerMutationDraft = { commonPatch: {} }
  const writers = fieldWriterTable(fields)
  return applyWriterTable(writers, draft, step.mutations).then(async () => {
    const prepared = await prepareSmartContentMutationV3(bus, layerId, draft,
      context?.signal ? AbortSignal.any([context.signal, bus.getLifecycleSignal()]) : bus.getLifecycleSignal())
    const commands: ImageEditCommandV3[] = [...prepared.commands]
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
    return { documentId, commands, release: prepared.release }
  })
}

export class ImageEditV3LayerMutationExecutor extends ImageEditV3MutationExecutorBase {
  readonly entityType = 'image_edit.layer' as const
  readonly writableProperties = writableProperties(LAYER_WRITERS)
  readonly propertyOperations = propertyOperations(LAYER_WRITERS)

  createCommands(step: MutationStep, context?: ApplicationExecutionContext): Promise<{ documentId: string; commands: ImageEditCommandV3[]; release?: () => Promise<void> }> {
    return layerCommands(step, this.entityType, IMAGE_EDIT_V3_LAYER_FIELDS, context)
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
    const { bus } = requireImageEditDocumentInstanceV3(documentId)
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

export class ImageEditV3DocumentMutationExecutor extends ImageEditV3MutationExecutorBase {
  readonly entityType = 'image_edit.document'
  private readonly writers = fieldWriterTable(IMAGE_EDIT_V3_DOCUMENT_FIELDS)
  private readonly historyWriters = fieldWriterTable(IMAGE_EDIT_HISTORY_FIELDS_V3)
  private readonly workflowWriters = fieldWriterTable(IMAGE_EDIT_WORKFLOW_FIELDS_V3)
  readonly writableProperties = new Set([...writableProperties(this.writers), ...writableProperties(this.historyWriters), ...writableProperties(this.workflowWriters)])
  readonly propertyOperations = new Map([...propertyOperations(this.writers), ...propertyOperations(this.historyWriters), ...propertyOperations(this.workflowWriters)])

  async createCommands(step: MutationStep): Promise<{ documentId: string; commands: ImageEditCommandV3[]; historyPosition?: number }> {
    const { documentId } = splitImageEditV3DocumentRef(step.target)
    const { bus } = requireImageEditDocumentInstanceV3(documentId)
    const document = bus.getSnapshot().document
    const historyMutations = step.mutations.filter(mutation => this.historyWriters[mutation.propertyId])
    if (historyMutations.length) {
      if (historyMutations.length !== step.mutations.length) throw new Error('恢复历史与修改画面请使用按顺序排列的独立 changes，避免修改被恢复操作覆盖')
      const draft: ImageEditHistoryMutationDraftV3 = {}
      await applyWriterTable(this.historyWriters, draft, historyMutations)
      return { documentId, commands: [], historyPosition: draft.position }
    }
    const geometry = structuredClone(document.geometry)
    const workflow: ImageEditWorkflowDraftV3 = {}
    const workflowMutations = step.mutations.filter(mutation => this.workflowWriters[mutation.propertyId])
    await applyWriterTable(this.workflowWriters, workflow, workflowMutations)
    const geometryMutations = step.mutations.filter(mutation => !this.workflowWriters[mutation.propertyId])
    await applyWriterTable(this.writers, geometry, geometryMutations)
    const orientationChanged = geometry.orientation.rotate !== document.geometry.orientation.rotate
      || geometry.orientation.mirrored !== document.geometry.orientation.mirrored
    const cropSpecified = step.mutations.some(mutation => mutation.propertyId === 'image_edit.document.crop_rect')
    return {
      documentId,
      commands: [...(workflow.regions ? [{ type: 'document.set-named-regions' as const, regions: workflow.regions,
        commandId: createImageEditIdV3('regions'), expectedRevision: document.revision }] : []),
        ...(workflow.moves ? [{ type: 'layer.move-many' as const, moves: workflow.moves,
          commandId: createImageEditIdV3('moves'), expectedRevision: document.revision }] : []), ...(geometryMutations.length ? [{
        type: 'document.update-output-geometry' as const,
        commandId: createImageEditIdV3('geometry'),
        expectedRevision: document.revision,
        orientation: geometry.orientation,
        crop: orientationChanged && !cropSpecified ? null : geometry.crop,
      }] : [])],
    }
  }
}
