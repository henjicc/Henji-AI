import { z } from 'zod'
import { unrestrictedCollectionAvailability, type ApplicationEntityRegistration, type ApplicationPropertyDescriptor, type JsonValue } from '@/core/application-control'
import { videoEditSchemaRef } from './videoEditFields'
import { useVideoEditEffectLibraryStore, videoEditPresetCreationProperties } from './videoEditEffectPresets'
import { videoEditDomainRevision } from './videoEditService'
import { videoEditEffectMaskSchema } from '@/core/videoEdit/effectMasks'

const entityType = 'video_edit.effect_preset'
const reason = '这是用户本机保存的效果模板目录；保存、重命名、删除由效果库管理。应用时读取 creation_items，在同一次通用事务中创建 video_edit.effect，保留片段撤销历史。'
const fields = [
  { key: 'name', title: '预设名称', value: { kind: 'string' as const, maxLength: 200 } },
  { key: 'media', title: '适用媒介', value: { kind: 'enum' as const, values: [{ value: 'video', label: '画面' }, { value: 'audio', label: '声音' }] } },
  { key: 'creation_items', title: '创建效果组合', value: { kind: 'json' as const, schemaRef: videoEditSchemaRef('property', `${entityType}.creation_items.value`) } },
]
const creationSchema = z.array(z.object({ properties: z.object({
  'video_edit.effect.definition_id': z.string(), 'video_edit.effect.parameters': z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  'video_edit.effect.name': z.string(), 'video_edit.effect.enabled': z.boolean(), 'video_edit.effect.amount': z.number().min(0).max(1),
  'video_edit.effect.mask': videoEditEffectMaskSchema.optional(),
}).strict() }).strict()).min(1).max(8)

export function createVideoEditEffectPresetRegistration(): ApplicationEntityRegistration {
  const revisions = (): Record<string, number> => ({ video_edit: videoEditDomainRevision() })
  const requirePreset = (ref: { kind: string; id: string }) => {
    const preset = useVideoEditEffectLibraryStore.getState().presets.find(preset => preset.id === ref.id)
    if (ref.kind !== entityType || !preset) throw new Error('NOT_FOUND：原效果预设已删除。')
    return preset
  }
  const properties: ApplicationPropertyDescriptor[] = fields.map(field => ({
    id: `${entityType}.${field.key}`, entityType, version: 1, title: field.title,
    description: field.key === 'creation_items' ? '现成的 create_items.items 数组；使用 video_edit.effect 和明确的片段 parent，一次创建整个组合（一步撤销）。video 只加画面片段，audio 只加声音片段；带智能区域的只加视频或图片。' : field.title,
    value: field.value, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: [] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${entityType}.${field.key}`), readOnlyReason: reason,
  }))
  return {
    entity: { id: entityType, domain: 'video_edit', version: 1, title: '本机效果预设', description: reason, refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', entityType), writeExclusion: { reason } },
    properties,
    schemaDocuments: [{ ref: videoEditSchemaRef('property', `${entityType}.creation_items.value`), value: z.toJSONSchema(creationSchema) as JsonValue }],
    provider: {
      entityType,
      async listEntities(request) {
        const presets = useVideoEditEffectLibraryStore.getState().presets
        const offset = Math.max(0, Number(request.cursor) || 0)
        return { refs: presets.slice(offset, offset + request.limit).map(preset => ({ kind: entityType, id: preset.id, label: preset.name })), nextCursor: offset + request.limit < presets.length ? String(offset + request.limit) : null, revisions: revisions() }
      },
      async readEntity(ref, request) {
        const preset = requirePreset(ref)
        const values: Record<string, JsonValue> = JSON.parse(JSON.stringify({ [`${entityType}.name`]: preset.name, [`${entityType}.media`]: preset.media, [`${entityType}.creation_items`]: videoEditPresetCreationProperties(preset).map(properties => ({ properties })) }))
        return { ref, entityType, revisions: revisions(), properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds!.includes(id))) : values, capturedAt: new Date().toISOString() }
      },
      async getPropertyAvailability(ref, propertyIds) {
        requirePreset(ref)
        return propertyIds.map(propertyId => {
          if (!properties.some(property => property.id === propertyId)) throw new Error(`PROPERTY_NOT_FOUND：${propertyId}`)
          return { propertyId, readable: true, writable: false, reasons: [reason], requiredPermissions: ['video_edit:read'], revisions: revisions() }
        })
      },
      async getCollectionAvailability(parent) {
        const available = unrestrictedCollectionAvailability(entityType, parent, revisions(), ['video_edit:read'])
        available.create = { ...available.create, available: false, reasons: [reason] }
        available.remove = { ...available.remove, available: false, reasons: [reason] }
        return available
      },
    },
  }
}
