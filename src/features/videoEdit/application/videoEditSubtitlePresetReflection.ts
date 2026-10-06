import { z } from 'zod'
import { fieldDescriptors, fieldReadValues, unrestrictedCollectionAvailability, type ApplicationEntityRegistration, type ApplicationFieldDefinition, type JsonValue } from '@/core/application-control'
import { videoEditSubtitleStyleSchema } from '@/core/videoEdit/subtitleStyle'
import { videoEditSchemaRef } from './videoEditFields'
import { listVideoEditSubtitlePresets, type VideoEditSubtitlePreset } from './videoEditSubtitlePresets'
import { videoEditDomainRevision } from './videoEditService'

const entityType = 'video_edit.subtitle_preset'
const reason = '本机字幕样式模板目录；保存与删除由字幕面板的本机预设库维护，不进入剪辑文件。应用时读取 style，在同一次通用事务中写入所选 video_edit.caption.style（一步撤销）。'
const fields: ApplicationFieldDefinition<VideoEditSubtitlePreset, VideoEditSubtitlePreset>[] = (['name', 'style'] as const).map(key => ({
  propertyId: `${entityType}.${key}`, storeActions: [], read: preset => key === 'name' ? preset.name : { ...preset.style },
  descriptor: {
    id: `${entityType}.${key}`, entityType, version: 1, title: key === 'name' ? '预设名称' : '字幕样式', description: key === 'name' ? '内置或本机保存的字幕样式预设名称。' : '读取此样式整体写入多个 video_edit.caption.style；多条修改放在同一次通用事务中，一步撤销。',
    value: key === 'name' ? { kind: 'string', maxLength: 200 } : { kind: 'json', schemaRef: videoEditSchemaRef('property', `${entityType}.style.value`) },
    nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: [] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${entityType}.${key}`), readOnlyReason: reason,
  },
}))
export function createVideoEditSubtitlePresetRegistration(): ApplicationEntityRegistration {
  const revisions = (): Record<string, number> => ({ video_edit: videoEditDomainRevision() })
  const requirePreset = (ref: { kind: string; id: string }): VideoEditSubtitlePreset => {
    const preset = listVideoEditSubtitlePresets().find(preset => preset.id === ref.id)
    if (ref.kind !== entityType || !preset) throw new Error('NOT_FOUND：原字幕预设已删除。')
    return preset
  }
  return {
    entity: { id: entityType, domain: 'video_edit', version: 1, title: '字幕样式预设', description: reason, refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', entityType), writeExclusion: { reason } },
    properties: fieldDescriptors(fields), schemaDocuments: [{ ref: videoEditSchemaRef('property', `${entityType}.style.value`), value: z.toJSONSchema(videoEditSubtitleStyleSchema) as JsonValue }],
    provider: {
      entityType,
      async listEntities(request) {
        const presets = listVideoEditSubtitlePresets(); const offset = Math.max(0, Number(request.cursor) || 0)
        return { refs: presets.slice(offset, offset + request.limit).map(preset => ({ kind: entityType, id: preset.id, label: preset.name })), nextCursor: offset + request.limit < presets.length ? String(offset + request.limit) : null, revisions: revisions() }
      },
      async readEntity(ref, request) {
        const values = fieldReadValues(fields, requirePreset(ref))
        return { ref, entityType, revisions: revisions(), properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds!.includes(id))) : values, capturedAt: new Date().toISOString() }
      },
      async getPropertyAvailability(ref, propertyIds) {
        requirePreset(ref)
        return propertyIds.map(propertyId => {
          if (!fields.some(field => field.propertyId === propertyId)) throw new Error(`PROPERTY_NOT_FOUND：${propertyId}`)
          return { propertyId, readable: true, writable: false, reasons: [reason], requiredPermissions: ['video_edit:read'], revisions: revisions() }
        })
      },
      async getCollectionAvailability(parent) {
        const available = unrestrictedCollectionAvailability(entityType, parent, revisions(), ['video_edit:read'])
        available.create = { ...available.create, available: false, reasons: [reason] }; available.remove = { ...available.remove, available: false, reasons: [reason] }; return available
      },
    },
  }
}
