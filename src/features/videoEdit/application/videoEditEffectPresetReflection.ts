import { z } from 'zod'
import { fieldDescriptors, fieldReadValues, fieldWriterTable, unrestrictedCollectionAvailability, type ApplicationRef, type ApplicationMutationExecutor, type ApplicationCollectionExecutor, type ApplicationPlannedStep, type ApplicationCompletedStepResult, type ApplicationEvidence, type ApplicationEffectReceipt, type ApplicationExecutionContext, type ApplicationEntityRegistration, type JsonValue } from '@/core/application-control'
import { videoEditSchemaRef } from './videoEditFields'
import { useVideoEditEffectLibraryStore, VIDEO_EDIT_EFFECT_LIBRARY_SCOPE, videoEditEffectLibraryRevisions } from './videoEditEffectPresets'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control/execution/writerTable'
import { type LibraryData } from './videoEditEffectPresets'
import { videoEditEffectMaskSchema } from '@/core/videoEdit/effectMasks'
import { videoEditCurvesSchema } from '@/core/videoEdit/keyframes'
import { codeMaterialInstanceSchema } from '@/core/videoEdit/codeMaterialPersistence'
import { resolveVideoEditStylePieceDefinition, videoEditStylePieceDefinitionInputSchema } from './videoEditStylePieceDefinition'
import { jsonEqual } from '@/core/jsonEqual'
import { videoEditEffectLibrarySchema } from '@/core/videoEdit/effectPresets'
import { effectPresetFields as fields, effectPresetEntityType as entityType, effectPresetDescription as reason } from './videoEditEffectPresetFields'
import { effectLibraryFields, EFFECT_LIBRARY_ENTITY, effectFavoriteIdsSchema } from './videoEditEffectLibraryFields'

export const videoEditPresetCreationItemsSchema = z.array(z.object({ properties: z.object({
  'video_edit.effect.definition_id': z.string(), 'video_edit.effect.parameters': codeMaterialInstanceSchema.shape.parameters,
  'video_edit.effect.name': z.string(), 'video_edit.effect.enabled': z.boolean(), 'video_edit.effect.amount': z.number().min(0).max(1),
  'video_edit.effect.mask': videoEditEffectMaskSchema.optional(),
  'video_edit.effect.frame_curves': videoEditCurvesSchema.optional(),
  'video_edit.effect.curves': codeMaterialInstanceSchema.shape.curves,
}).strict() }).strict())

export function createVideoEditEffectPresetRegistration(): ApplicationEntityRegistration {
  const revisions = (): Record<string, number> => videoEditEffectLibraryRevisions()
  const requirePreset = (ref: { kind: string; id: string }) => {
    const preset = useVideoEditEffectLibraryStore.getState().presets.find(preset => preset.id === ref.id)
    if (ref.kind !== entityType || !preset) throw new Error('NOT_FOUND：原效果预设已删除。')
    return preset
  }
  const properties = fieldDescriptors(fields)
  return {
    entity: { id: entityType, domain: 'video_edit', version: 1, title: '全局风格件', description: reason + '收藏与取消收藏写 video_edit.effect_library:singleton 的 favorite_ids；删除走通用 remove_items，进入最近删除，可从 settings.deleted_item 通用移出恢复。', refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['video_edit.style_library'], revisionScopes: [VIDEO_EDIT_EFFECT_LIBRARY_SCOPE], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', entityType), collectionWrite: { creatable: true, removable: true, requiredPropertyIds: [`${entityType}.definition`] } },
    properties,
    schemaDocuments: [{ ref: videoEditSchemaRef('property', `${entityType}.definition.value`), value: z.toJSONSchema(videoEditStylePieceDefinitionInputSchema) as JsonValue }, { ref: videoEditSchemaRef('property', `${entityType}.creation_items.value`), value: z.toJSONSchema(videoEditPresetCreationItemsSchema) as JsonValue }],
    provider: {
      entityType,
      async listEntities(request) {
        await useVideoEditEffectLibraryStore.getState().ready()
        const presets = useVideoEditEffectLibraryStore.getState().presets
        const offset = Math.max(0, Number(request.cursor) || 0)
        return { refs: presets.slice(offset, offset + request.limit).map(preset => ({ kind: entityType, id: preset.id, label: preset.name })), nextCursor: offset + request.limit < presets.length ? String(offset + request.limit) : null, revisions: revisions() }
      },
      async readEntity(ref, request) {
        await useVideoEditEffectLibraryStore.getState().ready()
        const preset = requirePreset(ref)
        const values = fieldReadValues(fields, preset)
        return { ref, entityType, revisions: revisions(), properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds!.includes(id))) : values, capturedAt: new Date().toISOString() }
      },
      async getPropertyAvailability(ref, propertyIds) {
        requirePreset(ref)
        return propertyIds.map(propertyId => {
          if (!properties.some(property => property.id === propertyId)) throw new Error(`PROPERTY_NOT_FOUND：${propertyId}`)
          const writable = writableProperties(fieldWriterTable(fields)).has(propertyId)
          return { propertyId, readable: true, writable, reasons: writable ? [] : ['由 definition 派生'], requiredPermissions: ['video_edit:read'], revisions: revisions() }
        })
      },
      async getCollectionAvailability(parent) {
        const available = unrestrictedCollectionAvailability(entityType, parent, revisions(), ['video_edit:read'])
        if (parent.kind !== 'video_edit.style_library' || parent.id !== 'singleton') available.create = { ...available.create, available: false, reasons: ['parent 使用 video_edit.style_library:singleton。'] }
        if (parent.kind !== 'video_edit.style_library' || parent.id !== 'singleton') available.remove = { ...available.remove, available: false, reasons: ['parent 使用 video_edit.style_library:singleton。'] }
        return available
      },
    },
  }
}

const favoriteCascade = { declarationId: 'video_edit.effect_library_favorites_update', effect: 'update' as const, entityType: EFFECT_LIBRARY_ENTITY, propertyIds: effectLibraryFields.map(field => field.propertyId), revisionScopes: [VIDEO_EDIT_EFFECT_LIBRARY_SCOPE] }
function favoriteEffects(before: LibraryData, after: LibraryData, refs: ApplicationRef[]): ApplicationEffectReceipt[] {
  return !jsonEqual(before.favorites, after.favorites) && !refs.some(ref => ref.kind === EFFECT_LIBRARY_ENTITY)
    ? [{ effect: favoriteCascade.effect, entityType: favoriteCascade.entityType, propertyIds: favoriteCascade.propertyIds, refs: [{ kind: EFFECT_LIBRARY_ENTITY, id: 'singleton' }], origin: { kind: 'cascade', declarationId: favoriteCascade.declarationId } }] : []
}
class StylePieceExecutor {
  readonly entityType: string = entityType
  readonly effectContract = { direct: [], cascades: [favoriteCascade] }
  private undos = new Map<string, ApplicationRef[]>()
  protected snapshot(): LibraryData { const { favorites, presets } = useVideoEditEffectLibraryStore.getState(); return structuredClone({ favorites, presets }) }
  private result(refs: ApplicationRef[], undoToken?: string, cascadeEffects: ApplicationEffectReceipt[] = []): ApplicationCompletedStepResult { return { status: 'completed', resultingRevisions: videoEditEffectLibraryRevisions(), directRefs: refs, cascadeEffects, evidence: [{ kind: 'entity_state', fact: '已回读正式全局风格件库。', capturedAt: new Date().toISOString() }], ...(undoToken ? { undoToken } : {}) } }
  protected async commit(before: LibraryData, after: LibraryData, refs: ApplicationRef[]): Promise<ApplicationCompletedStepResult> {
    let token: string
    try { token = await useVideoEditEffectLibraryStore.getState().saveLibrary(after, before) } catch (error) { throw notExecutedFailure(error) }
    const actual = this.snapshot()
    // 引用解析与来源归一化由宿主完成，按宿主候选核对正式读回，而非调用方的原始快照。
    if (!jsonEqual(actual, videoEditEffectLibrarySchema.parse(after))) {
      useVideoEditEffectLibraryStore.getState().undoLibrary(token)
      useVideoEditEffectLibraryStore.getState().forgetLibraryChange(token)
      throw notExecutedFailure(new Error('风格件保存读回不一致，已恢复原库。'))
    }
    this.undos.set(token, refs)
    return this.result(refs, token, favoriteEffects(before, actual, refs))
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const state = this.undos.get(token)
    if (!state) throw new Error('风格件库撤销记录不存在。')
    const before = this.snapshot()
    useVideoEditEffectLibraryStore.getState().undoLibrary(token); this.undos.delete(token)
    return this.result(state, undefined, favoriteEffects(before, this.snapshot(), state))
  }
  forget(token: string): void { this.undos.delete(token) }
  async compensate(_step: unknown, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    const undone = await this.undo(result.undoToken)
    useVideoEditEffectLibraryStore.getState().forgetLibraryChange(result.undoToken)
    return undone.evidence
  }
}
export class VideoEditStylePieceMutationExecutor extends StylePieceExecutor implements ApplicationMutationExecutor {
  readonly writableProperties = writableProperties(fieldWriterTable(fields))
  readonly propertyOperations = propertyOperations(fieldWriterTable(fields))
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    await useVideoEditEffectLibraryStore.getState().ready()
    const before = this.snapshot(), draft = structuredClone(before.presets.find(preset => preset.id === step.target.id))
    if (step.target.kind !== entityType || !draft) throw new Error('NOT_FOUND：请重新列出全局风格件。')
    const mutations = await Promise.all(step.mutations.map(async mutation => mutation.propertyId === `${entityType}.definition` ? { ...mutation, value: await resolveVideoEditStylePieceDefinition(mutation.value, draft.id, context.signal, draft) as unknown as JsonValue } : mutation))
    await applyWriterTable(fieldWriterTable(fields), draft, mutations)
    return this.commit(before, { ...before, presets: before.presets.map(preset => preset.id === draft.id ? draft : preset) }, [step.target])
  }
}
export class VideoEditStylePieceCollectionExecutor extends StylePieceExecutor implements ApplicationCollectionExecutor {
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    if (step.parent.kind !== 'video_edit.style_library' || step.parent.id !== 'singleton') throw new Error('全局风格件的 parent 使用 video_edit.style_library:singleton。')
    await useVideoEditEffectLibraryStore.getState().ready()
    const before = this.snapshot()
    if (step.operation.kind === 'remove') {
      const targets = step.operation.targets
      if (targets.some(target => target.kind !== entityType || !before.presets.some(preset => preset.id === target.id))) throw notExecutedFailure(new Error('NOT_FOUND：请重新列出全局风格件。'))
      const ids = new Set(targets.map(target => target.id))
      return this.commit(before, { presets: before.presets.filter(preset => !ids.has(preset.id)), favorites: before.favorites.filter(id => ![...ids].some(removed => id === `preset:${removed}`)) }, targets)
    }
    if (step.operation.kind !== 'create') throw notExecutedFailure(new Error('风格件只支持创建或删除。'))
    const added = await Promise.all(step.operation.items.map(async item => {
      const unknown = Object.keys(item.properties).filter(key => key !== `${entityType}.definition`)
      if (unknown.length) throw new Error(`创建风格件只接受 definition；多传的键：${unknown.join('、')}。`)
      return resolveVideoEditStylePieceDefinition(item.properties[`${entityType}.definition`], crypto.randomUUID(), context.signal)
    }))
    return this.commit(before, { ...before, presets: [...before.presets, ...added] }, added.map(preset => ({ kind: entityType, id: preset.id })))
  }
}

export function createVideoEditEffectLibraryRegistration(): ApplicationEntityRegistration {
  const requireLibrary = (ref: ApplicationRef): void => { if (ref.kind !== EFFECT_LIBRARY_ENTITY || ref.id !== 'singleton') throw new Error('NOT_FOUND：效果库使用 video_edit.effect_library:singleton。') }
  return {
    entity: { id: EFFECT_LIBRARY_ENTITY, domain: 'video_edit', version: 1, title: '效果库', description: '本机效果与风格件收藏；favorite_ids 可经通用修改增减，取消收藏不会删除内容。', refKind: EFFECT_LIBRARY_ENTITY, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: [VIDEO_EDIT_EFFECT_LIBRARY_SCOPE], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', EFFECT_LIBRARY_ENTITY) },
    properties: fieldDescriptors(effectLibraryFields),
    schemaDocuments: [{ ref: videoEditSchemaRef('property', `${EFFECT_LIBRARY_ENTITY}.favorite_ids.value`), value: z.toJSONSchema(effectFavoriteIdsSchema) as JsonValue }],
    provider: {
      entityType: EFFECT_LIBRARY_ENTITY,
      async listEntities() { await useVideoEditEffectLibraryStore.getState().ready(); return { refs: [{ kind: EFFECT_LIBRARY_ENTITY, id: 'singleton', label: '效果库' }], nextCursor: null, revisions: videoEditEffectLibraryRevisions() } },
      async readEntity(ref, request) { requireLibrary(ref); await useVideoEditEffectLibraryStore.getState().ready(); const values = fieldReadValues(effectLibraryFields, useVideoEditEffectLibraryStore.getState()); return { ref, entityType: EFFECT_LIBRARY_ENTITY, revisions: videoEditEffectLibraryRevisions(), properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds!.includes(id))) : values, capturedAt: new Date().toISOString() } },
      async getPropertyAvailability(ref, ids) { requireLibrary(ref); await useVideoEditEffectLibraryStore.getState().ready(); return ids.map(propertyId => { if (!effectLibraryFields.some(field => field.propertyId === propertyId)) throw new Error(`PROPERTY_NOT_FOUND：${propertyId}`); return { propertyId, readable: true, writable: true, reasons: [], requiredPermissions: ['video_edit:write'], revisions: videoEditEffectLibraryRevisions() } }) },
      async getCollectionAvailability(parent) { return unrestrictedCollectionAvailability(EFFECT_LIBRARY_ENTITY, parent, videoEditEffectLibraryRevisions(), ['video_edit:read']) },
    },
  }
}

export class VideoEditEffectLibraryMutationExecutor extends StylePieceExecutor implements ApplicationMutationExecutor {
  readonly entityType = EFFECT_LIBRARY_ENTITY
  readonly writableProperties = writableProperties(fieldWriterTable(effectLibraryFields))
  readonly propertyOperations = propertyOperations(fieldWriterTable(effectLibraryFields))
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    if (step.target.kind !== this.entityType || step.target.id !== 'singleton') throw notExecutedFailure(new Error('NOT_FOUND：效果库使用 video_edit.effect_library:singleton。'))
    await useVideoEditEffectLibraryStore.getState().ready()
    const before = this.snapshot(), after = structuredClone(before)
    await applyWriterTable(fieldWriterTable(effectLibraryFields), after, step.mutations)
    return this.commit(before, after, [step.target])
  }
}
