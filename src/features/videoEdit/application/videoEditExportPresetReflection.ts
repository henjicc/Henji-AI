import { z } from 'zod'
import { unrestrictedCollectionAvailability, type ApplicationEntityRegistration, type ApplicationCollectionExecutor, type ApplicationPlannedStep, type ApplicationCompletedStepResult, type ApplicationEvidence, type ApplicationExecutionContext, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { videoEditExportPresetSchema, videoEditExportSettingsSchema, type VideoEditExportPreset } from '@/core/videoEdit/exportPresets'
import { videoEditSchemaRef } from './videoEditFields'
import { requireVideoEditInstance, videoEditDomainRevision } from './videoEditService'
import { videoEditExportPresetLibrary } from './videoEditExportPresets'

const type = 'video_edit.export_preset'
const reason = '导出模板在本机保存；读取 settings 后按 presetRef 交给 export_video_edit。内置项固定，自定义项通过本实体的通用集合在任一剪辑 document 下创建或删除，模板不会写入该剪辑。修改已有模板请先保存新项再删除旧项。'
const fields = [
  { key: 'name', title: '预设名称', value: { kind: 'string' as const, maxLength: 200 } },
  { key: 'settings', title: '导出设置', value: { kind: 'json' as const, schemaRef: videoEditSchemaRef('property', `${type}.settings.value`) } },
]
export function createVideoEditExportPresetRegistration(): ApplicationEntityRegistration {
  const revisions = (): Record<string, number> => ({ video_edit: videoEditDomainRevision() })
  const requirePreset = (ref: ApplicationRef): VideoEditExportPreset => {
    const preset = videoEditExportPresetLibrary.list().find(value => value.id === ref.id)
    if (ref.kind !== type || !preset) throw new Error('NOT_FOUND：原导出预设不存在，请重新列出。')
    return preset
  }
  const properties = fields.map(field => ({ id: `${type}.${field.key}`, entityType: type, version: 1, title: field.title, description: field.key === 'settings' ? '分辨率、帧率（null 保持序列）、Mbps/kbps、画幅适配及整片响度（null 保持音量）。keepSequenceSize=true 保持原画幅；仅音频不使用画幅或帧率。' : field.title, value: field.value, nullable: false, dataClass: 'C1' as const, exposures: ['ui', 'assistant', 'local_adapter'] as Array<'ui' | 'assistant' | 'local_adapter'>, requiredPermissions: { read: ['video_edit:read'], write: ['video_edit:write'] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${type}.${field.key}`), readOnlyReason: reason }))
  return {
    entity: { id: type, domain: 'video_edit', version: 1, title: '导出预设', description: reason, refKind: type, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['video_edit.document'], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', type), collectionWrite: { creatable: true, removable: true, requiredPropertyIds: fields.map(field => `${type}.${field.key}`), maxItemsPerChange: 32 } },
    properties, schemaDocuments: [{ ref: videoEditSchemaRef('property', `${type}.settings.value`), value: z.toJSONSchema(videoEditExportSettingsSchema) as JsonValue }],
    provider: {
      entityType: type,
      async listEntities(request) { const all = videoEditExportPresetLibrary.list(); const offset = Math.max(0, Number(request.cursor) || 0); return { refs: all.slice(offset, offset + request.limit).map(value => ({ kind: type, id: value.id, label: value.name })), nextCursor: offset + request.limit < all.length ? String(offset + request.limit) : null, revisions: revisions() } },
      async readEntity(ref, request) { const preset = requirePreset(ref); const values: Record<string, JsonValue> = { [`${type}.name`]: preset.name, [`${type}.settings`]: { ...preset.settings } }; return { ref, entityType: type, properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(values).filter(([key]) => request.propertyIds!.includes(key))) : values, revisions: revisions(), capturedAt: new Date().toISOString() } },
      async getPropertyAvailability(ref, propertyIds) { requirePreset(ref); return propertyIds.map(propertyId => { if (!properties.some(value => value.id === propertyId)) throw new Error(`PROPERTY_NOT_FOUND：${propertyId}`); return { propertyId, readable: true, writable: false, reasons: [reason], requiredPermissions: ['video_edit:read'], revisions: revisions() } }) },
      async getCollectionAvailability(parent) {
        const result = unrestrictedCollectionAvailability(type, parent, revisions(), ['video_edit:write'])
        if (parent.kind !== 'video_edit.document') { result.create = { ...result.create, available: false, reasons: ['请选择已打开的剪辑 document 作为本机模板保存的上下文。'] }; result.remove = { ...result.remove, available: false, reasons: ['请选择已打开的剪辑 document。'] } }
        else requireVideoEditInstance(parent.id)
        return result
      },
    },
  }
}
export class VideoEditExportPresetExecutor implements ApplicationCollectionExecutor {
  readonly entityType = type
  readonly effectContract = { direct: [], cascades: [] }
  private undoStates = new Map<string, { before: VideoEditExportPreset[]; after: VideoEditExportPreset[]; refs: ApplicationRef[] }>()
  private result(refs: ApplicationRef[], undoToken?: string): ApplicationCompletedStepResult { return { status: 'completed', resultingRevisions: { video_edit: videoEditDomainRevision() }, directRefs: refs, evidence: [{ kind: 'entity_state', fact: '已从正式本机预设库回读。', capturedAt: new Date().toISOString() }], ...(undoToken ? { undoToken } : {}) } }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    if (step.parent.kind !== 'video_edit.document') throw new Error('请使用剪辑 document 作为本机预设上下文。')
    requireVideoEditInstance(step.parent.id)
    const before = videoEditExportPresetLibrary.custom(); let after = [...before]; const refs: ApplicationRef[] = []
    if (step.operation.kind === 'create') {
      for (const item of step.operation.items) {
        if (Object.keys(item.properties).some(key => !fields.some(field => `${type}.${field.key}` === key))) throw new Error('创建仅接受导出预设 name 与 settings。')
        const preset = videoEditExportPresetSchema.parse({ id: crypto.randomUUID(), name: item.properties[`${type}.name`], settings: item.properties[`${type}.settings`] })
        after.push(preset); refs.push({ kind: type, id: preset.id })
      }
    } else {
      for (const ref of step.operation.targets) { if (ref.kind !== type || !before.some(value => value.id === ref.id)) throw new Error('只可删除本机自定义预设；内置预设固定。'); refs.push(ref) }
      after = after.filter(value => !refs.some(ref => ref.id === value.id))
    }
    videoEditExportPresetLibrary.replace(after)
    const token = crypto.randomUUID(); this.undoStates.set(token, { before, after, refs })
    if (this.undoStates.size > 64) this.undoStates.delete(this.undoStates.keys().next().value!)
    return this.result(refs, token)
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const state = this.undoStates.get(token)
    if (!state || JSON.stringify(videoEditExportPresetLibrary.custom()) !== JSON.stringify(state.after)) throw new Error('本机预设已有后续修改，请重新读取。')
    videoEditExportPresetLibrary.replace(state.before); this.undoStates.delete(token); return this.result(state.refs)
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}
