import { fieldDescriptors, fieldReadValues, unrestrictedCollectionAvailability, type ApplicationEntityProvider, type ApplicationEntityRegistration, type ApplicationRef } from '@/core/application-control'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { VIDEO_EDIT_MAX_EFFECTS } from '@/core/videoEdit/compositing'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, describeVideoEditBuiltinEffect, parseVideoEditBuiltinRefId, requireVideoEditBuiltinEffect, videoEditBuiltinRefId } from '@/core/videoEdit/builtinEffects'
import { describeVideoEditTransitionKind, parseVideoEditTransitionRefId, videoEditTransitionClipIds, VIDEO_EDIT_TRANSITION_PRESETS, VIDEO_EDIT_TRANSITION_REF_PREFIX } from '@/core/videoEdit/transitions'
import { listVideoEditInstances, requireVideoEditInstance, getVideoEditTimelineView, videoEditDomainRevision as videoEditRevision } from './videoEditService'
import { VIDEO_EDIT_BUILTIN_CATALOG_READ_ONLY, VIDEO_EDIT_FIELDS, VIDEO_EDIT_TYPES, videoEditSchemaDocuments, videoEditSchemaRef, type VideoEditEntityType, type VideoEditFieldData } from './videoEditFields'
import { readVideoEditSource } from './videoEditSource'
import { getVideoEditPlaybackResolution } from './videoEditPlaybackResolution'
import { VIDEO_EDIT_COMPOSITE_TYPES, videoEditCompositeItems, videoEditCompositeData, videoEditCompositeOwner, type VideoEditCompositeEntityType } from './videoEditCompositeEntities'

export function splitVideoEditRef(ref: ApplicationRef): { projectId: string; childId: string } {
  if (ref.kind === 'video_edit.document') return { projectId: ref.id, childId: '' }
  const index = ref.id.indexOf(':'); if (index < 0) throw new Error('请使用目录返回的完整剪辑实体引用。')
  return { projectId: ref.id.slice(0, index), childId: ref.id.slice(index + 1) }
}
export function videoEditEntityItems(document: VideoEditDocument, type: VideoEditEntityType): Array<{ id: string; name?: string; text?: string }> {
  switch (type) {
    case 'video_edit.document': return [document]
    case 'video_edit.source': return [{ id: 'source', name: '源素材预览' }]
    case 'video_edit.sequence': return document.sequences
    case 'video_edit.bin': return document.bins
    case 'video_edit.item': return document.items
    case 'video_edit.media': return document.media
    case 'video_edit.clip': return document.sequences.flatMap(sequence => sequence.clips)
    case 'video_edit.annotation': return document.sequences.flatMap(sequence => sequence.annotations)
    case 'video_edit.marker': return document.sequences.flatMap(sequence => sequence.markers ?? [])
    case 'video_edit.caption': return document.sequences.flatMap(sequence => sequence.captions ?? [])
    case 'video_edit.track': return document.sequences.flatMap(sequence => sequence.tracks)
    case 'video_edit.code_material': return document.codeMaterials ?? []
    case 'video_edit.code_version': return (document.codeMaterials ?? []).flatMap(definition => definition.versions.map(version => ({ ...version, name: definition.name })))
    case 'video_edit.graphic_object': case 'video_edit.effect': case 'video_edit.transition': return videoEditCompositeItems(document, type)
    // 内置效果与过渡同一个只读目录：效果 effect:<ID>，过渡 transition:<种类>（4.7）
    case 'video_edit.builtin_effect': return [...VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.map(definition => ({ id: videoEditBuiltinRefId(definition.id), name: definition.name })), ...VIDEO_EDIT_TRANSITION_PRESETS.map(preset => ({ id: `${VIDEO_EDIT_TRANSITION_REF_PREFIX}${preset.kind}`, name: preset.name }))]
  }
}
export function readVideoEditData(ref: ApplicationRef): VideoEditFieldData {
  const { projectId, childId } = splitVideoEditRef(ref); const instance = requireVideoEditInstance(projectId)
  if (ref.kind === 'video_edit.document') return { name: instance.document.name, frame: instance.frame, selection: instance.selection ?? '', activeSequenceId: instance.activeSequenceId, dirty: instance.dirty, selectedItemIds: [...instance.selectedItemIds], selectedBinId: instance.selectedBinId, openSequenceIds: [...instance.openSequenceIds], timelineView: { ...getVideoEditTimelineView(projectId) }, programPlayback: { frame: instance.frame, playing: instance.playing, playbackDirection: instance.playbackDirection }, playbackResolution: { ...getVideoEditPlaybackResolution(projectId) } }
  if (ref.kind === 'video_edit.source') { if (childId !== 'source') throw new Error('NOT_FOUND：源预览引用无效。'); return { ...readVideoEditSource(projectId) } }
  if (VIDEO_EDIT_COMPOSITE_TYPES.some(type => type === ref.kind)) return videoEditCompositeData(instance.document, ref.kind as VideoEditCompositeEntityType, childId)
  if (ref.kind === 'video_edit.builtin_effect') {
    const transitionKind = parseVideoEditTransitionRefId(childId)
    if (transitionKind) return JSON.parse(JSON.stringify(describeVideoEditTransitionKind(transitionKind))) as VideoEditFieldData
    const id = parseVideoEditBuiltinRefId(childId)
    if (!id) throw new Error(`NOT_FOUND：没有内置效果 ${childId}，可用：${VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.map(definition => videoEditBuiltinRefId(definition.id)).join('、')}。`)
    const { name, group, description, params } = describeVideoEditBuiltinEffect(requireVideoEditBuiltinEffect(id))
    return JSON.parse(JSON.stringify({ name, group, description, params })) as VideoEditFieldData
  }
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
  if (!found) throw new Error('NOT_FOUND：目标不属于此剪辑或已删除。')
  const data = JSON.parse(JSON.stringify(found)) as VideoEditFieldData
  if (ref.kind === 'video_edit.clip') {
    const clip = instance.document.sequences.flatMap(sequence => sequence.clips).find(clip => clip.id === childId)!
    Object.assign(data, { graphicObjectIds: clip.graphic?.objects.map(object => object.id) ?? [], effectIds: clip.effects?.map(effect => effect.id) ?? [], adjustmentFromTrack: clip.adjustment?.fromTrack ?? null })
  }
  if (ref.kind === 'video_edit.item') {
    const item = instance.document.items.find(item => item.id === childId)!
    Object.assign(data, { graphicKind: item.graphic?.objects[0]?.kind ?? null, graphicWidth: item.graphic?.width ?? null, graphicHeight: item.graphic?.height ?? null })
  }
  return data
}
class VideoEditProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: VideoEditEntityType) {}
  async listEntities(request: { cursor?: string; limit: number }) {
    const all = listVideoEditInstances().flatMap(instance => videoEditEntityItems(instance.document, this.entityType).map(item => ({ kind: this.entityType, id: this.entityType === 'video_edit.document' ? item.id : `${instance.document.id}:${item.id}`, label: item.name ?? item.text ?? '标注' })))
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
      const wrongKind = propertyId === 'video_edit.clip.graphic_object_ids' && data.kind !== 'graphic' || propertyId === 'video_edit.clip.adjustment_from_track' && data.kind !== 'adjustment'
      const { projectId, childId } = splitVideoEditRef(ref); const document = requireVideoEditInstance(projectId).document
      const childOwner = VIDEO_EDIT_COMPOSITE_TYPES.some(type => type === this.entityType) ? videoEditCompositeOwner(document, this.entityType as VideoEditCompositeEntityType, childId) : undefined
      const locked = childOwner ? childOwner.clipIds.some(id => childOwner.sequence.tracks.find(track => track.index === childOwner.sequence.clips.find(clip => clip.id === id)?.track)?.locked) : false
      const reasons = absent ? ['此片段没有代码实例参数。'] : wrongKind ? ['此片段类型不支持该操作。'] : locked ? ['所属轨道已锁定。'] : field.writer ? [] : [field.descriptor.readOnlyReason!]
      return { propertyId, readable: true, writable: Boolean(field.writer) && !absent && !wrongKind && !locked, reasons, requiredPermissions: ['video_edit:read'], revisions: { video_edit: videoEditRevision() } }
    })
  }
  async getCollectionAvailability(parent: ApplicationRef) {
    readVideoEditData(parent)
    const availability = unrestrictedCollectionAvailability(this.entityType, parent, { video_edit: videoEditRevision() }, ['video_edit:write'])
    if (!VIDEO_EDIT_COMPOSITE_TYPES.some(type => type === this.entityType)) return availability
    const { projectId, childId } = splitVideoEditRef(parent); const document = requireVideoEditInstance(projectId).document
    let createReason = ''; let removeReason = ''
    if (this.entityType === 'video_edit.transition') {
      const sequence = document.sequences.find(sequence => sequence.id === childId)
      if (parent.kind !== 'video_edit.sequence' || !sequence) createReason = removeReason = '请选择所属序列。'
      else {
        const clips = sequence.clips.filter(clip => clip.kind !== 'adjustment' && !sequence.tracks.find(track => track.index === clip.track)?.locked)
        if (!clips.length) createReason = '需要未锁定轨道上的片段（过渡放在片段一端，或两个紧邻片段之间；视频过渡挂画面片段，音频过渡挂声音片段）。'
        if (!(sequence.transitions ?? []).some(transition => videoEditTransitionClipIds(transition).every(id => clips.some(clip => clip.id === id)))) removeReason = '没有可移除的未锁定转场。'
      }
    } else {
      const sequence = document.sequences.find(sequence => sequence.clips.some(clip => clip.id === childId)); const clip = sequence?.clips.find(clip => clip.id === childId)
      if (parent.kind !== 'video_edit.clip' || !clip) createReason = removeReason = '请选择所属片段。'
      else if (sequence!.tracks.find(track => track.index === clip.track)?.locked) createReason = removeReason = '所属轨道已锁定。'
      else if (this.entityType === 'video_edit.graphic_object') {
        if (!clip.graphic) createReason = removeReason = '请选择结构化图形片段。'
        else { if (clip.graphic.objects.length >= 32) createReason = '图形已达到32个对象上限。'; if (!clip.graphic.objects.length) removeReason = '此图形没有可移除的对象。' }
      } else { if ((clip.effects?.length ?? 0) >= VIDEO_EDIT_MAX_EFFECTS) createReason = `片段已达到${VIDEO_EDIT_MAX_EFFECTS}项效果上限，请先移除不用的效果。`; if (!clip.effects?.length) removeReason = '片段没有可移除的效果。' }
    }
    if (createReason) availability.create = { ...availability.create, available: false, reasons: [createReason] }
    if (removeReason) availability.remove = { ...availability.remove, available: false, reasons: [removeReason] }
    return availability
  }
}
const titles: Record<VideoEditEntityType, string> = { 'video_edit.document': '剪辑', 'video_edit.sequence': '剪辑序列', 'video_edit.bin': '素材箱', 'video_edit.item': '素材项', 'video_edit.track': '序列轨道', 'video_edit.clip': '剪辑片段', 'video_edit.annotation': '画面标注', 'video_edit.media': '原路径素材', 'video_edit.source': '源素材预览', 'video_edit.code_material': '原生代码素材', 'video_edit.code_version': '固定源码版本', 'video_edit.marker': '时间标记', 'video_edit.caption': '导出字幕', 'video_edit.graphic_object': '片段图形对象', 'video_edit.effect': '片段效果', 'video_edit.transition': '序列转场', 'video_edit.builtin_effect': '内置效果与过渡目录' }
const sequenceChildren = ['video_edit.clip', 'video_edit.annotation', 'video_edit.track', 'video_edit.marker', 'video_edit.caption', 'video_edit.transition']
const required: Partial<Record<VideoEditEntityType, string[]>> = {
  'video_edit.sequence': ['video_edit.sequence.name'], 'video_edit.bin': ['video_edit.bin.name'], 'video_edit.item': ['video_edit.item.name', 'video_edit.item.kind'],
  'video_edit.clip': ['video_edit.clip.item_id', 'video_edit.clip.kind', 'video_edit.clip.name'], 'video_edit.annotation': ['video_edit.annotation.clip_id', 'video_edit.annotation.text'],
  'video_edit.marker': ['video_edit.marker.frame', 'video_edit.marker.name'], 'video_edit.track': ['video_edit.track.kind'], 'video_edit.caption': ['video_edit.caption.start', 'video_edit.caption.duration', 'video_edit.caption.text'],
  'video_edit.code_material': ['video_edit.code_material.source'],
  'video_edit.code_version': ['video_edit.code_version.source', 'video_edit.code_version.definition_id'],
  'video_edit.graphic_object': ['video_edit.graphic_object.kind'],
  'video_edit.effect': ['video_edit.effect.definition_id'],
  // 两端片段可只写一端（单侧过渡），由创建时的编辑点校验给出可用端点。
  'video_edit.transition': ['video_edit.transition.duration_frames'],
}
export function createVideoEditRegistrations(): ApplicationEntityRegistration[] {
  return VIDEO_EDIT_TYPES.map(entityType => ({
    entity: { id: entityType, domain: 'video_edit', version: 2, title: titles[entityType], description: entityType === 'video_edit.source' ? '独立源预览会话；定位、播放写入等待真实媒体响应，逐帧观察不改剪辑内容或撤销历史。' : entityType === 'video_edit.builtin_effect' ? '剪辑内置的 GPU 视频效果（模糊、调色、马赛克、暗角、裁剪、抠像等）、音频效果（参数均衡、高通低通、压缩、限幅、去齿音、降噪、混响、音调变换、增益与声道平衡）与过渡（擦除、推动、滑动、缩放、模糊、闪光、圆形划像；音频恒定功率、恒定增益、指数淡化）及参数语义；预览与导出一致。效果用 video_edit.effect 加到片段上（说明以“音频效果”开头的只加声音片段），过渡用 video_edit.transition 放到编辑点上。' : entityType === 'video_edit.effect' ? '片段效果链里的一项：内置效果（definition_id 为 effect:<ID>）或代码滤镜；画面片段上从上到下依次处理画面，声音片段上依次处理声音（只接受音频内置效果）。' : '本地剪辑中的稳定实体，手动与助手共用编辑历史。', refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: entityType === 'video_edit.document' ? [] : ['video_edit.graphic_object', 'video_edit.effect'].includes(entityType) ? ['video_edit.clip'] : sequenceChildren.includes(entityType) ? ['video_edit.sequence'] : ['video_edit.document'], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', entityType),
      ...(entityType === 'video_edit.media' ? { writeExclusion: { reason: '素材由正式本地导入或素材库引用服务检测；路径选择由用户本地文件对话框授权。' } } : {}),
      ...(entityType === 'video_edit.builtin_effect' ? { writeExclusion: { reason: VIDEO_EDIT_BUILTIN_CATALOG_READ_ONLY } } : {}),
      ...(required[entityType] ? { collectionWrite: { creatable: true, removable: entityType !== 'video_edit.code_version', requiredPropertyIds: required[entityType]!, maxItemsPerChange: 32 } } : {}),
    }, properties: fieldDescriptors(VIDEO_EDIT_FIELDS[entityType]), provider: new VideoEditProvider(entityType), schemaDocuments: videoEditSchemaDocuments(entityType),
  }))
}
