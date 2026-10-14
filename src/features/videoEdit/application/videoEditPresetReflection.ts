import { fieldDescriptors, fieldReadValues, fieldWriterTable, unrestrictedCollectionAvailability, type ApplicationFieldDefinition, type ApplicationMutationExecutor, type ApplicationEntityRegistration, type ApplicationPlannedStep, type ApplicationCompletedStepResult, type ApplicationEvidence, type ApplicationExecutionContext, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control/execution/writerTable'
import { useSettingsStore } from '@/stores/settingsStore'
import type { VideoEditTransitionKind } from '@/core/videoEdit/transitions'
import { VIDEO_EDIT_PRESET_CATEGORIES, VIDEO_EDIT_PRESET_CATEGORY_LABELS, VIDEO_EDIT_PRESET_DEFAULTABLE, VIDEO_EDIT_PRESET_MAX_RATING, type VideoEditPresetCategory, type VideoEditPresetPreference } from '@/core/videoEdit/presetPackage'
import { videoEditSchemaRef } from './videoEditFields'
import { videoEditDomainRevision } from './videoEditService'
import { listAllVideoEditPresets, requireVideoEditPreset, setVideoEditPresetDefault, setVideoEditPresetRating, type VideoEditPresetEntry } from './videoEditPresetCatalog'
import { videoEditPresetPreferences } from './videoEditPresetPreferences'

export const PRESET_ENTITY = 'video_edit.preset'
const SOURCE_ENTITY: Partial<Record<VideoEditPresetCategory, string>> = { style: 'video_edit.style_preset', title: 'video_edit.title_template', text: 'video_edit.subtitle_preset', effect: 'video_edit.effect_preset' }
const description = '剪辑预设面板里的全部预设（风格、标题、文字、效果、转场）及用户偏好。rating 为喜爱程度 0–5（0 未评分），is_default 为该类默认（效果没有默认）：风格默认会自动套到新建序列，文字默认用于新字幕，标题默认用于未指定模板的标题，转场默认即默认过渡。用户没有指定时优先用默认，没有默认就推荐 recommended（评分最高）。内容本身经 source_ref 指向的原实体读写或删除。'
type Entry = VideoEditPresetEntry
interface Draft { entry: Entry; rating: number; isDefault: boolean }
function key(category: VideoEditPresetCategory, id: string): string { return `${category}:${id}` }
function parse(ref: ApplicationRef): { category: VideoEditPresetCategory; id: string } {
  const colon = ref.id.indexOf(':'); const category = ref.id.slice(0, colon) as VideoEditPresetCategory
  if (ref.kind !== PRESET_ENTITY || colon < 0 || !VIDEO_EDIT_PRESET_CATEGORIES.includes(category)) throw new Error(`NOT_FOUND：预设引用应为“类别:标识”，类别为 ${VIDEO_EDIT_PRESET_CATEGORIES.join('、')}；请重新列出 ${PRESET_ENTITY}。`)
  return { category, id: ref.id.slice(colon + 1) }
}
const readOnly = (name: string, title: string, value: ApplicationFieldDefinition<Draft, Draft>['descriptor']['value'], read: (draft: Draft) => JsonValue): ApplicationFieldDefinition<Draft, Draft> => ({
  propertyId: `${PRESET_ENTITY}.${name}`, storeActions: [], read,
  descriptor: { id: `${PRESET_ENTITY}.${name}`, entityType: PRESET_ENTITY, version: 1, title, description: title, value, nullable: name === 'source_ref', dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: [] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${PRESET_ENTITY}.${name}`), readOnlyReason: '由预设库维护；内容请经 source_ref 指向的原实体修改。' },
})
const fields: ApplicationFieldDefinition<Draft, Draft>[] = [
  readOnly('name', '预设名称', { kind: 'string', maxLength: 200 }, draft => draft.entry.name),
  readOnly('category', '预设类别', { kind: 'enum', values: VIDEO_EDIT_PRESET_CATEGORIES.map(value => ({ value, label: VIDEO_EDIT_PRESET_CATEGORY_LABELS[value] })) }, draft => draft.entry.category),
  readOnly('summary', '适用说明', { kind: 'string', maxLength: 2000 }, draft => draft.entry.meta),
  readOnly('builtin', '内置预设', { kind: 'boolean' }, draft => draft.entry.builtin),
  readOnly('recommended', '推荐（未设为默认中评分最高）', { kind: 'boolean' }, draft => draft.entry.recommended),
  readOnly('source_ref', '原实体引用（类型:标识）；转场没有', { kind: 'string', maxLength: 300 }, draft => SOURCE_ENTITY[draft.entry.category] ? `${SOURCE_ENTITY[draft.entry.category]}:${draft.entry.id}` : null),
  { propertyId: `${PRESET_ENTITY}.rating`, storeActions: [], read: draft => draft.rating,
    writer: { write(draft, mutation) { const value = mutation.value; if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > VIDEO_EDIT_PRESET_MAX_RATING) throw new Error(`rating 须为 0–${VIDEO_EDIT_PRESET_MAX_RATING} 的整数，0 表示清除评分。`); draft.rating = value } },
    descriptor: { id: `${PRESET_ENTITY}.rating`, entityType: PRESET_ENTITY, version: 1, title: '喜爱程度', description: '0–5 的整数，0 清除评分；只在用户明确表达喜好时修改。', value: { kind: 'integer', hardRange: { min: 0, max: VIDEO_EDIT_PRESET_MAX_RATING } }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: ['video_edit:write'] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${PRESET_ENTITY}.rating`) } },
  { propertyId: `${PRESET_ENTITY}.is_default`, storeActions: [], read: draft => draft.isDefault,
    writer: { write(draft, mutation) { if (typeof mutation.value !== 'boolean') throw new Error('is_default 须为布尔值。'); draft.isDefault = mutation.value } },
    descriptor: { id: `${PRESET_ENTITY}.is_default`, entityType: PRESET_ENTITY, version: 1, title: '设为默认', description: 'true 设为该类默认（同类原默认自动取消），false 取消；效果预设没有默认。', value: { kind: 'boolean' }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: ['video_edit:write'] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${PRESET_ENTITY}.is_default`) } },
]
const draftOf = (ref: ApplicationRef): Draft => { const { category, id } = parse(ref); const entry = requireVideoEditPreset(category, id); return { entry, rating: entry.rating, isDefault: entry.isDefault } }
const revisions = (): Record<string, number> => ({ video_edit: videoEditDomainRevision() })
export function createVideoEditPresetRegistration(): ApplicationEntityRegistration {
  const properties = fieldDescriptors(fields)
  return {
    entity: { id: PRESET_ENTITY, domain: 'video_edit', version: 1, title: '剪辑预设', description, refKind: PRESET_ENTITY, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', PRESET_ENTITY) },
    properties,
    provider: {
      entityType: PRESET_ENTITY,
      async listEntities(request) { const all = listAllVideoEditPresets(); const offset = Math.max(0, Number(request.cursor) || 0); return { refs: all.slice(offset, offset + request.limit).map(entry => ({ kind: PRESET_ENTITY, id: key(entry.category, entry.id), label: `${VIDEO_EDIT_PRESET_CATEGORY_LABELS[entry.category]} · ${entry.name}` })), nextCursor: offset + request.limit < all.length ? String(offset + request.limit) : null, revisions: revisions() } },
      async readEntity(ref, request) { const values = fieldReadValues(fields, draftOf(ref)); return { ref, entityType: PRESET_ENTITY, properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds!.includes(id))) : values, revisions: revisions(), capturedAt: new Date().toISOString() } },
      async getPropertyAvailability(ref, propertyIds) {
        const { category } = parse(ref); draftOf(ref)
        return propertyIds.map(propertyId => {
          if (!properties.some(value => value.id === propertyId)) throw new Error(`PROPERTY_NOT_FOUND：${propertyId}；可用属性：${properties.map(value => value.id).join('、')}`)
          const writable = propertyId.endsWith('.rating') || propertyId.endsWith('.is_default') && VIDEO_EDIT_PRESET_DEFAULTABLE.includes(category)
          return { propertyId, readable: true, writable, reasons: writable ? [] : [propertyId.endsWith('.is_default') ? '效果预设没有默认项。' : '由预设库维护。'], requiredPermissions: ['video_edit:read', ...(writable ? ['video_edit:write'] : [])], revisions: revisions() }
        })
      },
      async getCollectionAvailability(parent) {
        const result = unrestrictedCollectionAvailability(PRESET_ENTITY, parent, revisions(), ['video_edit:read'])
        const reason = '预设由各自的库创建、导入或删除；删除请经 source_ref 指向的原实体。'
        return { ...result, create: { ...result.create, available: false, reasons: [reason] }, remove: { ...result.remove, available: false, reasons: [reason] } }
      },
    },
  }
}
interface Undo { preferences: VideoEditPresetPreference[]; transition: string | undefined; after: string; target: ApplicationRef }
const snapshot = (): Pick<Undo, 'preferences' | 'transition'> => ({ preferences: videoEditPresetPreferences.custom(), transition: useSettingsStore.getState().videoEditDefaultTransitions.video })
const fingerprint = (): string => JSON.stringify(snapshot())
/** Ratings and defaults only; one step undoes both the preference file and the default-transition setting. */
export class VideoEditPresetMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = PRESET_ENTITY
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties = writableProperties(fieldWriterTable(fields))
  readonly propertyOperations = propertyOperations(fieldWriterTable(fields))
  private undos = new Map<string, Undo>()
  private result(target: ApplicationRef, undoToken?: string): ApplicationCompletedStepResult { return { status: 'completed', resultingRevisions: revisions(), directRefs: [target], evidence: [{ kind: 'entity_state', fact: '已回读预设评分与默认。', capturedAt: new Date().toISOString() }], ...(undoToken ? { undoToken } : {}) } }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    const { category, id } = parse(step.target); const before = draftOf(step.target); const draft = structuredClone(before); const saved = snapshot()
    await applyWriterTable(fieldWriterTable(fields), draft, step.mutations)
    context.signal?.throwIfAborted()
    if (draft.rating !== before.rating) setVideoEditPresetRating(category, id, draft.rating)
    if (draft.isDefault !== before.isDefault) setVideoEditPresetDefault(category, draft.isDefault ? id : null)
    const token = crypto.randomUUID(); this.undos.set(token, { ...saved, after: fingerprint(), target: step.target })
    if (this.undos.size > 64) this.undos.delete(this.undos.keys().next().value!)
    return this.result(step.target, token)
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const state = this.undos.get(token)
    if (!state || fingerprint() !== state.after) throw new Error('预设评分或默认已有后续修改，请重新读取。')
    videoEditPresetPreferences.replace(state.preferences); useSettingsStore.getState().setVideoEditDefaultTransition('video', (state.transition ?? null) as VideoEditTransitionKind | null)
    this.undos.delete(token); return this.result(state.target)
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}
