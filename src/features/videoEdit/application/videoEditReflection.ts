import { fieldDescriptors, fieldReadValues, unrestrictedCollectionAvailability, type ApplicationEntityProvider, type ApplicationEntityRegistration, type ApplicationRef } from '@/core/application-control'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { listVideoEditInstances, requireVideoEditInstance, videoEditDomainRevision as videoEditRevision } from './videoEditService'
import { VIDEO_EDIT_FIELDS, VIDEO_EDIT_TYPES, videoEditSchemaDocuments, videoEditSchemaRef, type VideoEditEntityType, type VideoEditFieldData } from './videoEditFields'
import { readVideoEditSource } from './videoEditSource'

export function splitVideoEditRef(ref: ApplicationRef): { projectId: string; childId: string } {
  if (ref.kind === 'video_edit.project') return { projectId: ref.id, childId: '' }
  const index = ref.id.indexOf(':'); if (index < 0) throw new Error('请使用目录返回的完整剪辑实体引用。')
  return { projectId: ref.id.slice(0, index), childId: ref.id.slice(index + 1) }
}
export function videoEditEntityItems(document: VideoEditDocument, type: VideoEditEntityType): Array<{ id: string; name?: string; text?: string }> {
  switch (type) {
    case 'video_edit.project': return [document]
    case 'video_edit.source': return [{ id: 'source', name: '源素材预览' }]
    case 'video_edit.sequence': return document.sequences
    case 'video_edit.bin': return document.bins
    case 'video_edit.item': return document.items
    case 'video_edit.media': return document.media
    case 'video_edit.clip': return document.sequences.flatMap(sequence => sequence.clips)
    case 'video_edit.annotation': return document.sequences.flatMap(sequence => sequence.annotations)
    case 'video_edit.track': return document.sequences.flatMap(sequence => sequence.tracks)
    case 'video_edit.code_material': return document.codeMaterials ?? []
    case 'video_edit.code_version': return (document.codeMaterials ?? []).flatMap(definition => definition.versions.map(version => ({ ...version, name: definition.name })))
  }
}
export function readVideoEditData(ref: ApplicationRef): VideoEditFieldData {
  const { projectId, childId } = splitVideoEditRef(ref); const instance = requireVideoEditInstance(projectId)
  if (ref.kind === 'video_edit.project') return { name: instance.document.name, frame: instance.frame, selection: instance.selection ?? '', activeSequenceId: instance.activeSequenceId, dirty: instance.dirty, selectedItemIds: [...instance.selectedItemIds], selectedBinId: instance.selectedBinId, openSequenceIds: [...instance.openSequenceIds] }
  if (ref.kind === 'video_edit.source') { if (childId !== 'source') throw new Error('NOT_FOUND：源预览引用无效。'); return { ...readVideoEditSource(projectId) } }
  if (ref.kind === 'video_edit.code_material') {
    const definition = instance.document.codeMaterials?.find(value => value.id === childId)
    if (!definition) throw new Error('NOT_FOUND：代码素材定义不存在。')
    const item = instance.document.items.find(item => item.code?.definitionId === childId)
    return { name: definition.name, source: definition.versions.find(version => version.id === definition.defaultVersionId)!.source, defaultVersionId: definition.defaultVersionId, versionIds: definition.versions.map(version => version.id), binId: item?.binId ?? '' }
  }
  if (ref.kind === 'video_edit.code_version') {
    const definition = instance.document.codeMaterials?.find(value => value.versions.some(version => version.id === childId))
    const version = definition?.versions.find(version => version.id === childId)
    if (!definition || !version) throw new Error('NOT_FOUND：固定代码版本不存在。')
    return { ...version, definitionId: definition.id }
  }
  if (!VIDEO_EDIT_TYPES.includes(ref.kind as VideoEditEntityType)) throw new Error('未知剪辑实体类型。')
  const found = videoEditEntityItems(instance.document, ref.kind as VideoEditEntityType).find(item => item.id === childId)
  if (!found) throw new Error('NOT_FOUND：目标不属于此工程或已删除。')
  return JSON.parse(JSON.stringify(found)) as VideoEditFieldData
}
class VideoEditProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: VideoEditEntityType) {}
  async listEntities(request: { cursor?: string; limit: number }) {
    const all = listVideoEditInstances().flatMap(instance => videoEditEntityItems(instance.document, this.entityType).map(item => ({ kind: this.entityType, id: this.entityType === 'video_edit.project' ? item.id : `${instance.document.id}:${item.id}`, label: item.name ?? item.text ?? '标注' })))
    const offset = Math.max(0, Number(request.cursor) || 0)
    return { refs: all.slice(offset, offset + request.limit), nextCursor: offset + request.limit < all.length ? String(offset + request.limit) : null, revisions: { video_edit: videoEditRevision() } }
  }
  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    const data = fieldReadValues(VIDEO_EDIT_FIELDS[this.entityType], readVideoEditData(ref))
    return { ref, entityType: this.entityType, revisions: { video_edit: videoEditRevision() }, properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(data).filter(([key]) => request.propertyIds!.includes(key))) : data, capturedAt: new Date().toISOString() }
  }
  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    const data = readVideoEditData(ref)
    return propertyIds.map(propertyId => {
      const field = VIDEO_EDIT_FIELDS[this.entityType].find(item => item.propertyId === propertyId)
      if (!field) throw new Error(`未知属性 ${propertyId}，可用属性：${VIDEO_EDIT_FIELDS[this.entityType].map(item => item.propertyId).join('、')}`)
      const absent = ['video_edit.clip.code_parameters', 'video_edit.clip.code_curves', 'video_edit.clip.code_version_id'].includes(propertyId) && !data.code
      return { propertyId, readable: true, writable: Boolean(field.writer) && !absent, reasons: absent ? ['此片段没有代码实例参数。'] : field.writer ? [] : [field.descriptor.readOnlyReason!], requiredPermissions: ['video_edit:read'], revisions: { video_edit: videoEditRevision() } }
    })
  }
  async getCollectionAvailability(parent: ApplicationRef) { readVideoEditData(parent); return unrestrictedCollectionAvailability(this.entityType, parent, { video_edit: videoEditRevision() }, ['video_edit:write']) }
}
const titles: Record<VideoEditEntityType, string> = { 'video_edit.project': '剪辑工程', 'video_edit.sequence': '剪辑序列', 'video_edit.bin': '素材箱', 'video_edit.item': '项目项', 'video_edit.track': '序列轨道', 'video_edit.clip': '剪辑片段', 'video_edit.annotation': '画面标注', 'video_edit.media': '原路径素材', 'video_edit.source': '源素材预览', 'video_edit.code_material': '原生代码素材', 'video_edit.code_version': '固定源码版本' }
const sequenceChildren = ['video_edit.clip', 'video_edit.annotation', 'video_edit.track']
const required: Partial<Record<VideoEditEntityType, string[]>> = {
  'video_edit.sequence': ['video_edit.sequence.name'], 'video_edit.bin': ['video_edit.bin.name'], 'video_edit.item': ['video_edit.item.name', 'video_edit.item.kind'],
  'video_edit.clip': ['video_edit.clip.item_id', 'video_edit.clip.kind', 'video_edit.clip.name'], 'video_edit.annotation': ['video_edit.annotation.clip_id', 'video_edit.annotation.text'],
  'video_edit.code_material': ['video_edit.code_material.source'],
  'video_edit.code_version': ['video_edit.code_version.source', 'video_edit.code_version.definition_id'],
}
export function createVideoEditRegistrations(): ApplicationEntityRegistration[] {
  return VIDEO_EDIT_TYPES.map(entityType => ({
    entity: { id: entityType, domain: 'video_edit', version: 2, title: titles[entityType], description: entityType === 'video_edit.source' ? '独立源预览会话；定位、播放写入等待真实媒体响应，逐帧观察不改工程或剪辑撤销历史。' : '本地剪辑工程中的稳定实体，手动与助手共用编辑历史。', refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: entityType === 'video_edit.project' ? [] : sequenceChildren.includes(entityType) ? ['video_edit.sequence'] : ['video_edit.project'], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', entityType),
      ...(entityType === 'video_edit.media' ? { writeExclusion: { reason: '素材由正式本地导入或素材库引用服务检测；路径选择由用户本地文件对话框授权。' } } : {}),
      ...(required[entityType] ? { collectionWrite: { creatable: true, removable: entityType !== 'video_edit.code_version', requiredPropertyIds: required[entityType]!, maxItemsPerChange: 32 } } : {}),
    }, properties: fieldDescriptors(VIDEO_EDIT_FIELDS[entityType]), provider: new VideoEditProvider(entityType), schemaDocuments: videoEditSchemaDocuments(entityType),
  }))
}
