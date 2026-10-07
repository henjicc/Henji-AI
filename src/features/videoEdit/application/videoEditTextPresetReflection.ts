import { z } from 'zod'
import { fieldDescriptors, fieldReadValues, fieldWriterTable, unrestrictedCollectionAvailability, type ApplicationFieldDefinition, type ApplicationMutationExecutor, type ApplicationEntityRegistration, type ApplicationCollectionExecutor, type ApplicationPlannedStep, type ApplicationCompletedStepResult, type ApplicationEvidence, type ApplicationExecutionContext, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control/execution/writerTable'
import { VIDEO_EDIT_TEXT_STYLE_DESCRIPTION, videoEditTextStyleSchema } from '@/core/videoEdit/text'
import { videoEditTextPresetSchema, type VideoEditTextPreset } from './videoEditTextPresets'
import { videoEditSchemaRef } from './videoEditFields'
import { requireVideoEditInstance, videoEditDomainRevision } from './videoEditService'
import { videoEditTextPresetLibrary } from './videoEditTextPresets'

const type = 'video_edit.text_preset'
const reason = '本机共享文字样式预设。通过通用集合创建/删除，属性 name 重命名、style 修改。读取 style 写入 clip.text_style、graphic_object.text_style、title_template.definition.parameters.textStyle 或 caption.style（字幕保留 bottomMargin）；应用进入目标剪辑撤销栈。'
const field = (key: 'name' | 'style', title: string, description: string, value: ApplicationFieldDefinition<VideoEditTextPreset, VideoEditTextPreset>['descriptor']['value']): ApplicationFieldDefinition<VideoEditTextPreset, VideoEditTextPreset> => ({
  propertyId: `${type}.${key}`, storeActions: [], read: preset => preset[key] as JsonValue,
  writer: { write: (draft, mutation) => { if (key === 'name') draft.name = videoEditTextPresetSchema.shape.name.parse(mutation.value); else draft.style = videoEditTextStyleSchema.parse(mutation.value) } },
  descriptor: { id: `${type}.${key}`, entityType: type, version: 1, title, description, value, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: ['video_edit:write'] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${type}.${key}`) },
})
const fields = [
  field('name', '预设名称', '自定义预设名称；内置预设不可修改。', { kind: 'string', maxLength: 200 }),
  field('style', '文字样式', '本机共享预设；通用增删改，读style写入目标文字属性时按宿主转换空间单位。' + VIDEO_EDIT_TEXT_STYLE_DESCRIPTION, { kind: 'json', schemaRef: videoEditSchemaRef('property', `${type}.style.value`) }),
]
export function createVideoEditTextPresetRegistration(): ApplicationEntityRegistration {
  const revisions = (): Record<string, number> => ({ video_edit: videoEditDomainRevision() })
  const requirePreset = (ref: ApplicationRef): VideoEditTextPreset => {
    const preset = videoEditTextPresetLibrary.list().find(value => value.id === ref.id)
    if (ref.kind !== type || !preset) throw new Error('NOT_FOUND：原文字样式预设不存在，请重新列出。')
    return preset
  }
  const properties = fieldDescriptors(fields)
  return {
    entity: { id: type, domain: 'video_edit', version: 1, title: '文字样式预设', description: reason, refKind: type, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['video_edit.document'], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', type), collectionWrite: { creatable: true, removable: true, requiredPropertyIds: fields.map(field => field.propertyId), maxItemsPerChange: 32 } },
    properties, schemaDocuments: [{ ref: videoEditSchemaRef('property', `${type}.style.value`), value: z.toJSONSchema(videoEditTextStyleSchema) as JsonValue }],
    provider: {
      entityType: type,
      async listEntities(request) { const all = videoEditTextPresetLibrary.list(); const offset = Math.max(0, Number(request.cursor) || 0); return { refs: all.slice(offset, offset + request.limit).map(value => ({ kind: type, id: value.id, label: value.name })), nextCursor: offset + request.limit < all.length ? String(offset + request.limit) : null, revisions: revisions() } },
      async readEntity(ref, request) { const values = fieldReadValues(fields, requirePreset(ref)); return { ref, entityType: type, properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(values).filter(([key]) => request.propertyIds!.includes(key))) : values, revisions: revisions(), capturedAt: new Date().toISOString() } },
      async getPropertyAvailability(ref, propertyIds) { const preset = requirePreset(ref); return propertyIds.map(propertyId => { if (!properties.some(value => value.id === propertyId)) throw new Error(`PROPERTY_NOT_FOUND：${propertyId}`); const writable = !preset.id.startsWith('builtin:'); return { propertyId, readable: true, writable, reasons: writable ? [] : ['内置预设不可修改，请保存为新的自定义预设。'], requiredPermissions: ['video_edit:read', ...(writable ? ['video_edit:write'] : [])], revisions: revisions() } }) },
      async getCollectionAvailability(parent) {
        const result = unrestrictedCollectionAvailability(type, parent, revisions(), ['video_edit:write'])
        if (parent.kind !== 'video_edit.document') { result.create = { ...result.create, available: false, reasons: ['请选择已打开的剪辑 document 作为本机模板保存的上下文。'] }; result.remove = { ...result.remove, available: false, reasons: ['请选择已打开的剪辑 document。'] } }
        else requireVideoEditInstance(parent.id)
        return result
      },
    },
  }
}
export class VideoEditTextPresetExecutor implements ApplicationCollectionExecutor {
  readonly entityType = type
  readonly effectContract = { direct: [], cascades: [] }
  private undoStates = new Map<string, { before: VideoEditTextPreset[]; after: VideoEditTextPreset[]; refs: ApplicationRef[] }>()
  private result(refs: ApplicationRef[], undoToken?: string): ApplicationCompletedStepResult { return { status: 'completed', resultingRevisions: { video_edit: videoEditDomainRevision() }, directRefs: refs, evidence: [{ kind: 'entity_state', fact: '已从正式本机预设库回读。', capturedAt: new Date().toISOString() }], ...(undoToken ? { undoToken } : {}) } }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    if (step.parent.kind !== 'video_edit.document') throw new Error('请使用剪辑 document 作为本机预设上下文。')
    requireVideoEditInstance(step.parent.id)
    const before = videoEditTextPresetLibrary.custom(); let after = [...before]; const refs: ApplicationRef[] = []
    if (step.operation.kind === 'create') {
      for (const item of step.operation.items) {
        if (Object.keys(item.properties).some(key => !fields.some(field => field.propertyId === key))) throw new Error('创建仅接受文字样式预设 name 与 style。')
        const preset = videoEditTextPresetSchema.parse({ id: crypto.randomUUID(), name: item.properties[`${type}.name`], style: item.properties[`${type}.style`] })
        after.push(preset); refs.push({ kind: type, id: preset.id })
      }
    } else {
      for (const ref of step.operation.targets) { if (ref.kind !== type || !before.some(value => value.id === ref.id)) throw new Error('只可删除本机自定义预设；内置预设固定。'); refs.push(ref) }
      after = after.filter(value => !refs.some(ref => ref.id === value.id))
    }
    videoEditTextPresetLibrary.replace(after)
    const token = crypto.randomUUID(); this.undoStates.set(token, { before, after, refs })
    if (this.undoStates.size > 64) this.undoStates.delete(this.undoStates.keys().next().value!)
    return this.result(refs, token)
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const state = this.undoStates.get(token)
    if (!state || JSON.stringify(videoEditTextPresetLibrary.custom()) !== JSON.stringify(state.after)) throw new Error('本机预设已有后续修改，请重新读取。')
    videoEditTextPresetLibrary.replace(state.before); this.undoStates.delete(token); return this.result(state.refs)
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}

export class VideoEditTextPresetMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = type
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties = writableProperties(fieldWriterTable(fields))
  readonly propertyOperations = propertyOperations(fieldWriterTable(fields))
  private undos = new Map<string, { before: VideoEditTextPreset; after: VideoEditTextPreset; target: ApplicationRef }>()
  private result(target: ApplicationRef, undoToken?: string): ApplicationCompletedStepResult { return { status: 'completed', resultingRevisions: { video_edit: videoEditDomainRevision() }, directRefs: [target], evidence: [{ kind: 'entity_state', fact: '已回读本机自定义文字样式预设。', capturedAt: new Date().toISOString() }], ...(undoToken ? { undoToken } : {}) } }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    const before = videoEditTextPresetLibrary.custom().find(value => value.id === step.target.id)
    if (step.target.kind !== type || !before) throw new Error('只能修改本机自定义文字样式预设，内置预设固定。')
    const draft = structuredClone(before)
    await applyWriterTable(fieldWriterTable(fields), draft, step.mutations)
    context.signal?.throwIfAborted()
    if (JSON.stringify(videoEditTextPresetLibrary.custom().find(value => value.id === before.id)) !== JSON.stringify(before)) throw new Error('原预设已有后续修改，请重新读取。')
    const after = videoEditTextPresetLibrary.update(before.id, draft)
    const token = crypto.randomUUID(); this.undos.set(token, { before, after, target: step.target })
    return this.result(step.target, token)
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const state = this.undos.get(token)
    if (!state || JSON.stringify(videoEditTextPresetLibrary.custom().find(value => value.id === state.before.id)) !== JSON.stringify(state.after)) throw new Error('原预设已有后续修改，请重新读取。')
    videoEditTextPresetLibrary.update(state.before.id, state.before); this.undos.delete(token); return this.result(state.target)
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}
