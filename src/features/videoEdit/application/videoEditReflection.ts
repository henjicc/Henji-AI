import { fieldDescriptors, fieldReadValues, unrestrictedCollectionAvailability, type ApplicationEntityProvider, type ApplicationEntityRegistration, type ApplicationRef } from '@/core/application-control'
import { listVideoEditInstances, requireVideoEditInstance, videoEditDomainRevision as videoEditRevision } from './videoEditService'
import { VIDEO_EDIT_FIELDS, VIDEO_EDIT_TYPES, videoEditSchemaDocuments, videoEditSchemaRef, type VideoEditEntityType, type VideoEditFieldData } from './videoEditFields'

export function splitVideoEditRef(ref: ApplicationRef): { projectId: string; childId: string } {
  if (ref.kind === 'video_edit.project') return { projectId: ref.id, childId: '' }
  const index = ref.id.indexOf(':'); if (index < 0) throw new Error('请使用目录返回的完整剪辑实体引用。')
  return { projectId: ref.id.slice(0, index), childId: ref.id.slice(index + 1) }
}
export function readVideoEditData(ref: ApplicationRef): VideoEditFieldData {
  const { projectId, childId } = splitVideoEditRef(ref); const instance = requireVideoEditInstance(projectId)
  if (ref.kind === 'video_edit.project') return { name: instance.document.name, frame: instance.frame, selection: instance.selection ?? '', width: instance.document.width, height: instance.document.height, fps: instance.document.fps, dirty: instance.dirty }
  const items = ref.kind === 'video_edit.clip' ? instance.document.clips : ref.kind === 'video_edit.annotation' ? instance.document.annotations : instance.document.media
  const found = items.find(item => item.id === childId); if (!found) throw new Error('NOT_FOUND：目标不属于此工程或已删除。')
  return JSON.parse(JSON.stringify(found)) as VideoEditFieldData
}
class VideoEditProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: VideoEditEntityType) {}
  async listEntities(request: { cursor?: string; limit: number }) {
    const all = listVideoEditInstances().flatMap(instance => {
      if (this.entityType === 'video_edit.project') return [{ kind: this.entityType, id: instance.document.id, label: instance.document.name }]
      const items = this.entityType === 'video_edit.clip' ? instance.document.clips : this.entityType === 'video_edit.annotation' ? instance.document.annotations : instance.document.media
      return items.map(item => ({ kind: this.entityType, id: `${instance.document.id}:${item.id}`, label: 'name' in item ? item.name : item.text || '标注' }))
    })
    const offset = Math.max(0, Number(request.cursor) || 0)
    return { refs: all.slice(offset, offset + request.limit), nextCursor: offset + request.limit < all.length ? String(offset + request.limit) : null, revisions: { video_edit: videoEditRevision() } }
  }
  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    const data = fieldReadValues(VIDEO_EDIT_FIELDS[this.entityType], readVideoEditData(ref))
    return { ref, entityType: this.entityType, revisions: { video_edit: videoEditRevision() }, properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(data).filter(([key]) => request.propertyIds!.includes(key))) : data, capturedAt: new Date().toISOString() }
  }
  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    readVideoEditData(ref)
    return propertyIds.map(propertyId => {
      const field = VIDEO_EDIT_FIELDS[this.entityType].find(item => item.propertyId === propertyId)
      if (!field) throw new Error(`未知属性 ${propertyId}，可用属性：${VIDEO_EDIT_FIELDS[this.entityType].map(item => item.propertyId).join('、')}`)
      return { propertyId, readable: true, writable: Boolean(field.writer), reasons: field.writer ? [] : [field.descriptor.readOnlyReason!], requiredPermissions: ['video_edit:read'], revisions: { video_edit: videoEditRevision() } }
    })
  }
  async getCollectionAvailability(parent: ApplicationRef) { requireVideoEditInstance(parent.id); return unrestrictedCollectionAvailability(this.entityType, parent, { video_edit: videoEditRevision() }, ['video_edit:write']) }
}
export function createVideoEditRegistrations(): ApplicationEntityRegistration[] {
  return VIDEO_EDIT_TYPES.map(entityType => ({
    entity: { id: entityType, domain: 'video_edit', version: 1, title: { 'video_edit.project': '剪辑工程', 'video_edit.clip': '剪辑片段', 'video_edit.annotation': '画面标注', 'video_edit.media': '原路径素材' }[entityType], description: '本地剪辑工程中的稳定实体，手动与助手共用编辑历史。', refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: entityType === 'video_edit.project' ? [] : ['video_edit.project'], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', entityType),
      ...(entityType === 'video_edit.media' ? { writeExclusion: { reason: '素材由正式本地导入或素材库引用服务检测；路径选择由用户本地文件对话框授权。' } } : {}),
      ...(['video_edit.clip', 'video_edit.annotation'].includes(entityType) ? { collectionWrite: { creatable: true, removable: true, requiredPropertyIds: entityType === 'video_edit.clip' ? ['video_edit.clip.kind', 'video_edit.clip.name'] : ['video_edit.annotation.clip_id', 'video_edit.annotation.text'], maxItemsPerChange: 32 } } : {}),
    }, properties: fieldDescriptors(VIDEO_EDIT_FIELDS[entityType]), provider: new VideoEditProvider(entityType), schemaDocuments: videoEditSchemaDocuments(entityType),
  }))
}
