import { z } from 'zod'
import { fieldDescriptors, fieldReadValues, fieldWriterTable, unrestrictedCollectionAvailability, type ApplicationFieldDefinition, type ApplicationRef, type ApplicationMutationExecutor, type ApplicationCollectionExecutor, type ApplicationPlannedStep, type ApplicationCompletedStepResult, type ApplicationEvidence, type ApplicationExecutionContext, type ApplicationEntityRegistration, type ApplicationPropertyDescriptor, type JsonValue } from '@/core/application-control'
import { videoEditSchemaRef } from './videoEditFields'
import { useVideoEditEffectLibraryStore, videoEditPresetCreationProperties, VIDEO_EDIT_EFFECT_LIBRARY_SCOPE, videoEditEffectLibraryRevisions } from './videoEditEffectPresets'
import { videoEditEffectPresetSchema, type VideoEditEffectPreset } from '@/core/videoEdit/effectPresets'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control/execution/writerTable'
import { type LibraryData } from './videoEditEffectPresets'
import { videoEditEffectMaskSchema } from '@/core/videoEdit/effectMasks'
import { videoEditCurvesSchema } from '@/core/videoEdit/keyframes'

const entityType = 'video_edit.effect_preset'
const reason = '全局风格件。先按名称、说明和用途找；读取 definition 后用 look(name, knobs)。新建或修改代表用户口味，先展示具体内容，向用户确认一次再用通用实体写入；不要自行保存口味。风格包成员读写 video_edit.style.effect_presets；绑定后的工程副本可覆盖同名全局件。'
function field(key: string, title: string, value: ApplicationPropertyDescriptor['value'], read: (preset: VideoEditEffectPreset) => JsonValue, write?: (draft: VideoEditEffectPreset, value: unknown) => void): ApplicationFieldDefinition<VideoEditEffectPreset, VideoEditEffectPreset> {
  const id = `${entityType}.${key}`
  return { propertyId: id, storeActions: [], read, ...(write ? { writer: { write: (draft, mutation) => write(draft, mutation.value) } } : {}), descriptor: {
    id, entityType, version: 1, title, description: key === 'definition' ? reason + 'definition 是完整风格件，id 由宿主管理；mappings 用效果实例 id 和参数键，points 两点为线性、多点为分段线性。' : key === 'creation_items' ? '将非空数组用作 create_items.items，在同一次事务向目标 clip 创建 video_edit.effect；纯图层风格件返回空数组，请在作者图层使用 look。' : title,
    value, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: write ? ['video_edit:write'] : [] }, revisionScopes: [VIDEO_EDIT_EFFECT_LIBRARY_SCOPE], schemaRef: videoEditSchemaRef('property', id), ...(write ? {} : { readOnlyReason: '由完整 definition 派生；修改请写 definition。' }),
  } }
}
function parseDefinition(value: unknown, id: string): VideoEditEffectPreset {
  try {
    const input = z.record(z.string(), z.unknown()).parse(value)
    const unknown = Object.keys(input).filter(key => !Object.hasOwn(videoEditEffectPresetSchema.shape, key))
    if (unknown.length) throw new Error(`definition 多传的键：${unknown.join('、')}。`)
    return videoEditEffectPresetSchema.parse({ ...input, id })
  } catch (error) { throw notExecutedFailure(error) }
}
const definitionInputSchema = z.object({ ...videoEditEffectPresetSchema.shape, id: videoEditEffectPresetSchema.shape.id.optional() }).strict()
const fields = [
  field('name', '名称', { kind: 'string', maxLength: 200 }, preset => preset.name),
  field('description', '说明', { kind: 'string' }, preset => preset.description ?? ''),
  field('usage', '用途', { kind: 'string' }, preset => preset.usage ?? ''),
  field('media', '适用媒介', { kind: 'enum', values: [{ value: 'video', label: '画面' }, { value: 'audio', label: '声音' }] }, preset => preset.media),
  field('definition', '风格件', { kind: 'json', schemaRef: videoEditSchemaRef('property', `${entityType}.definition.value`) }, preset => preset as unknown as JsonValue, (draft, value) => { const parsed = parseDefinition(value, draft.id); for (const key of ['description', 'usage', 'knobs'] as const) delete draft[key]; Object.assign(draft, parsed) }),
  field('creation_items', '创建效果组合', { kind: 'json', schemaRef: videoEditSchemaRef('property', `${entityType}.creation_items.value`) }, preset => videoEditPresetCreationProperties(preset).map(properties => ({ properties })) as JsonValue),
]
export const videoEditPresetCreationItemsSchema = z.array(z.object({ properties: z.object({
  'video_edit.effect.definition_id': z.string(), 'video_edit.effect.parameters': z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  'video_edit.effect.name': z.string(), 'video_edit.effect.enabled': z.boolean(), 'video_edit.effect.amount': z.number().min(0).max(1),
  'video_edit.effect.mask': videoEditEffectMaskSchema.optional(),
  'video_edit.effect.frame_curves': videoEditCurvesSchema.optional(),
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
    entity: { id: entityType, domain: 'video_edit', version: 1, title: '全局风格件', description: reason, refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['video_edit.style_library'], revisionScopes: [VIDEO_EDIT_EFFECT_LIBRARY_SCOPE], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', entityType), collectionWrite: { creatable: true, removable: false, requiredPropertyIds: [`${entityType}.definition`], maxItemsPerChange: 32 } },
    properties,
    schemaDocuments: [{ ref: videoEditSchemaRef('property', `${entityType}.definition.value`), value: z.toJSONSchema(definitionInputSchema) as JsonValue }, { ref: videoEditSchemaRef('property', `${entityType}.creation_items.value`), value: z.toJSONSchema(videoEditPresetCreationItemsSchema) as JsonValue }],
    provider: {
      entityType,
      async listEntities(request) {
        const presets = useVideoEditEffectLibraryStore.getState().presets
        const offset = Math.max(0, Number(request.cursor) || 0)
        return { refs: presets.slice(offset, offset + request.limit).map(preset => ({ kind: entityType, id: preset.id, label: preset.name })), nextCursor: offset + request.limit < presets.length ? String(offset + request.limit) : null, revisions: revisions() }
      },
      async readEntity(ref, request) {
        const preset = requirePreset(ref)
        const values = fieldReadValues(fields, preset)
        return { ref, entityType, revisions: revisions(), properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds!.includes(id))) : values, capturedAt: new Date().toISOString() }
      },
      async getPropertyAvailability(ref, propertyIds) {
        requirePreset(ref)
        return propertyIds.map(propertyId => {
          if (!properties.some(property => property.id === propertyId)) throw new Error(`PROPERTY_NOT_FOUND：${propertyId}`)
          return { propertyId, readable: true, writable: propertyId === `${entityType}.definition`, reasons: propertyId === `${entityType}.definition` ? [] : ['由 definition 派生'], requiredPermissions: ['video_edit:read'], revisions: revisions() }
        })
      },
      async getCollectionAvailability(parent) {
        const available = unrestrictedCollectionAvailability(entityType, parent, revisions(), ['video_edit:read'])
        if (parent.kind !== 'video_edit.style_library' || parent.id !== 'singleton') available.create = { ...available.create, available: false, reasons: ['parent 使用 video_edit.style_library:singleton。'] }
        available.remove = { ...available.remove, available: false, reasons: [reason] }
        return available
      },
    },
  }
}

class StylePieceExecutor {
  readonly entityType = entityType
  readonly effectContract = { direct: [], cascades: [] }
  private undos = new Map<string, { before: LibraryData; after: LibraryData; refs: ApplicationRef[] }>()
  protected snapshot(): LibraryData { const { favorites, presets } = useVideoEditEffectLibraryStore.getState(); return structuredClone({ favorites, presets }) }
  private result(refs: ApplicationRef[], undoToken?: string): ApplicationCompletedStepResult { return { status: 'completed', resultingRevisions: videoEditEffectLibraryRevisions(), directRefs: refs, evidence: [{ kind: 'entity_state', fact: '已回读正式全局风格件库。', capturedAt: new Date().toISOString() }], ...(undoToken ? { undoToken } : {}) } }
  protected commit(before: LibraryData, after: LibraryData, refs: ApplicationRef[]): ApplicationCompletedStepResult {
    try { useVideoEditEffectLibraryStore.getState().restoreLibrary(after) } catch (error) { throw notExecutedFailure(error) }
    const token = crypto.randomUUID(); this.undos.set(token, { before, after: this.snapshot(), refs })
    return this.result(refs, token)
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const state = this.undos.get(token)
    if (!state) throw new Error('风格件库撤销记录不存在。')
    useVideoEditEffectLibraryStore.getState().restoreLibrary(state.before, state.after); this.undos.delete(token)
    return this.result(state.refs)
  }
  forget(token: string): void { this.undos.delete(token) }
  async compensate(_step: unknown, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}
export class VideoEditStylePieceMutationExecutor extends StylePieceExecutor implements ApplicationMutationExecutor {
  readonly writableProperties = writableProperties(fieldWriterTable(fields))
  readonly propertyOperations = propertyOperations(fieldWriterTable(fields))
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    const before = this.snapshot(), draft = structuredClone(before.presets.find(preset => preset.id === step.target.id))
    if (step.target.kind !== entityType || !draft) throw new Error('NOT_FOUND：请重新列出全局风格件。')
    await applyWriterTable(fieldWriterTable(fields), draft, step.mutations)
    return this.commit(before, { ...before, presets: before.presets.map(preset => preset.id === draft.id ? draft : preset) }, [step.target])
  }
}
export class VideoEditStylePieceCollectionExecutor extends StylePieceExecutor implements ApplicationCollectionExecutor {
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    if (step.parent.kind !== 'video_edit.style_library' || step.parent.id !== 'singleton' || step.operation.kind !== 'create') throw new Error('创建全局风格件的 parent 使用 video_edit.style_library:singleton。')
    const before = this.snapshot()
    const added = step.operation.items.map(item => {
      const unknown = Object.keys(item.properties).filter(key => key !== `${entityType}.definition`)
      if (unknown.length) throw new Error(`创建风格件只接受 definition；多传的键：${unknown.join('、')}。`)
      return parseDefinition(item.properties[`${entityType}.definition`], crypto.randomUUID())
    })
    return this.commit(before, { ...before, presets: [...before.presets, ...added] }, added.map(preset => ({ kind: entityType, id: preset.id })))
  }
}
