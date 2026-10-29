import { createCodeProjectRegistrations } from './videoEditCodeProjectReflection'
import { getVideoEditAudioLinkNotices } from './videoEditAudioLinks'
import { getVideoEditRenderPreference, readVideoEditRenderCache } from './videoEditRenderCache'
import { videoEditCaptionClipIds } from '@/core/videoEdit/captionSpeech'
import { readVideoEditMediaAudio, videoEditContentAudioProgress } from './videoEditContentAudio'
import { readVideoEditMusicStructure } from './videoEditMusicRemix'
import type { JsonValue } from '@/core/application-control/identifiers'
import { createCodeComponentRegistration } from './videoEditCodeComponentReflection'
import { createVideoEditExplanationRegistration } from './videoEditExplanationReflection'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { createVideoEditTextPresetRegistration } from './videoEditTextPresetReflection'
import { videoEditImportTask } from './videoEditImportTask'
import { readVideoEditContentQueries } from './videoEditContentQueryProgress'
import type { ApplicationControlAccessContext } from '@/core/application-control'
import { ensureVideoEditCodeParameterMetadata, readVideoEditCodeParameterMetadata } from './videoEditCodeState'
import { videoEditSelectedCodeElementContext } from './videoEditCodeElements'
import { ensureVideoEditProxyState, getVideoEditProxyPreference, readVideoEditProxyState } from './videoEditProxy'
import { fieldDescriptors, fieldReadValues, unrestrictedCollectionAvailability, type ApplicationEntityProvider, type ApplicationEntityRegistration, type ApplicationRef } from '@/core/application-control'
import { videoEditClipMedia, type VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditClipSpeedData } from './videoEditClipSpeed'
import { videoEditComposition } from '@/core/videoEdit/document'
import { videoEditTranscriptWords, resolveVideoEditTextRanges } from '@/core/videoEdit/textTranscript'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, describeVideoEditBuiltinEffect, parseVideoEditBuiltinRefId, requireVideoEditBuiltinEffect, videoEditBuiltinRefId } from '@/core/videoEdit/builtinEffects'
import { describeVideoEditTransitionKind, parseVideoEditTransitionRefId, videoEditTransitionClipIds, VIDEO_EDIT_TRANSITION_PRESETS, VIDEO_EDIT_TRANSITION_REF_PREFIX } from '@/core/videoEdit/transitions'
import { listVideoEditInstances, requireVideoEditInstance, openVideoEditDocument, getVideoEditTimelineView, videoEditDomainRevision as videoEditRevision } from './videoEditService'
import { VIDEO_EDIT_BUILTIN_CATALOG_READ_ONLY, VIDEO_EDIT_FIELDS, VIDEO_EDIT_TYPES, videoEditDataKey, videoEditSchemaDocuments, videoEditSchemaRef, type VideoEditEntityType, type VideoEditFieldData } from './videoEditFields'
import { readVideoEditSource } from './videoEditSource'
import { getVideoEditPlaybackResolution } from './videoEditPlaybackResolution'
import { VIDEO_EDIT_COMPOSITE_TYPES, videoEditCompositeItems, videoEditCompositeData, videoEditCompositeOwner, type VideoEditCompositeEntityType } from './videoEditCompositeEntities'
import { createVideoEditEffectPresetRegistration } from './videoEditEffectPresetReflection'
import { createVideoEditPresetRegistration } from './videoEditPresetReflection'
import { createVideoEditSubtitlePresetRegistration } from './videoEditSubtitlePresetReflection'
import { createVideoEditExportPresetRegistration } from './videoEditExportPresetReflection'
import { createFontRegistration } from './fontReflection'
import { createVideoEditStyleRegistrations } from './videoEditStyleReflection'
import { VIDEO_EDIT_SCENE_LIMITS } from '@/core/videoEdit/scene/sceneSchema'
import { VIDEO_EDIT_SCENE, VIDEO_EDIT_SCENE_DECLARATION_BLOCK, VIDEO_EDIT_SCENE_FIELDS, VIDEO_EDIT_SCENE_RECORD, VIDEO_EDIT_SCENE_RECORD_REQUIRED, VIDEO_EDIT_SCENE_REQUIRED, VIDEO_EDIT_SCENE_TYPES, parseVideoEditSceneRef, videoEditSceneRecordRef, videoEditSceneRef, videoEditSceneSchemaDocuments, type VideoEditSceneEntityType, type VideoEditSceneFieldSource } from './videoEditSceneFields'
import { findVideoEditScene, loadVideoEditSceneDeclarations } from './videoEditScenes'
import { videoEditSceneMedia } from '@/core/videoEdit/scene/sceneMedia'

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
    case 'video_edit.tracker': case 'video_edit.graphic_object': case 'video_edit.effect': case 'video_edit.transition': return videoEditCompositeItems(document, type)
    // 内置效果与过渡同一个只读目录：效果 effect:<ID>，过渡 transition:<种类>（4.7）
    case 'video_edit.builtin_effect': return [...VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.map(definition => ({ id: videoEditBuiltinRefId(definition.id), name: definition.name })), ...VIDEO_EDIT_TRANSITION_PRESETS.map(preset => ({ id: `${VIDEO_EDIT_TRANSITION_REF_PREFIX}${preset.kind}`, name: preset.name }))]
  }
}
/** 只核对引用指向的实体仍在，不读属性：删除前核对父序列、`propertyIds: []` 读基线都走这里，避免整份克隆序列和重算转写。 */
export function assertVideoEditEntityExists(ref: ApplicationRef): void {
  const { projectId, childId } = splitVideoEditRef(ref); const instance = requireVideoEditInstance(projectId)
  if (ref.kind === 'video_edit.document') return
  if (!VIDEO_EDIT_TYPES.includes(ref.kind as VideoEditEntityType)) throw new Error('未知剪辑实体类型。')
  if (!videoEditEntityItems(instance.document, ref.kind as VideoEditEntityType).some(item => item.id === childId)) throw new Error('NOT_FOUND：目标不属于此剪辑或已删除。')
}
export function readVideoEditData(ref: ApplicationRef, codeMetadata = false, propertyIds?: readonly string[]): VideoEditFieldData {
  const { projectId, childId } = splitVideoEditRef(ref); const instance = requireVideoEditInstance(projectId)
  if (ref.kind === 'video_edit.document') return { audioLinkNotices: getVideoEditAudioLinkNotices(projectId).map(n => ({ ...n })), audioAnalysisProgress: videoEditContentAudioProgress(projectId), selectedCodeElement: JSON.parse(JSON.stringify(videoEditSelectedCodeElementContext(instance))), mediaImport: (() => { const task = videoEditImportTask(projectId); return task ? { phase: task.phase, completed: task.completed, total: task.total, totalKnown: task.totalKnown ?? false, discovered: task.discovered ?? task.total, queued: task.queued, requests: task.requests, imported: task.imported, skipped: task.skipped } : null })(), proxyPreference: { ...getVideoEditProxyPreference(projectId) }, colorLuts: (instance.document.colorLuts ?? []).map(({ id, name }) => ({ id, name })), name: instance.document.name, frame: instance.frame, selection: instance.selection ?? '', activeSequenceId: instance.activeSequenceId, dirty: instance.dirty, selectedItemIds: [...instance.selectedItemIds], selectedBinId: instance.selectedBinId, openSequenceIds: [...instance.openSequenceIds], timelineView: { ...getVideoEditTimelineView(projectId) }, programPlayback: { frame: instance.frame, playing: instance.playing, playbackDirection: instance.playbackDirection }, playbackResolution: { ...getVideoEditPlaybackResolution(projectId) }, renderCache: JSON.parse(JSON.stringify(readVideoEditRenderCache(projectId))), renderPreference: { ...getVideoEditRenderPreference(projectId) } }
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
    const contents = codeMaterialSource(instance.document, { definitionId: definition.id, versionId: definition.defaultVersionId, parameters: {} }).contents
    return { projectEntry: definition.versions.find(version => version.id === definition.defaultVersionId)?.project?.entry ?? '', name: definition.name, source: contents.files[contents.entry], ...contents, defaultVersionId: definition.defaultVersionId, versionIds: definition.versions.map(version => version.id), binId: item?.binId ?? '', ...(codeMetadata ? JSON.parse(JSON.stringify(readVideoEditCodeParameterMetadata(instance, instance.document, definition.id, definition.defaultVersionId))) as VideoEditFieldData : {}) }
  }
  if (ref.kind === 'video_edit.code_version') {
    const definition = instance.document.codeMaterials?.find(value => value.versions.some(version => version.id === childId))
    const version = definition?.versions.find(version => version.id === childId)
    if (!definition || !version) throw new Error('NOT_FOUND：固定代码版本不存在。')
    const contents = codeMaterialSource(instance.document, { definitionId: definition.id, versionId: version.id, parameters: {} }).contents
    return { isDefault: definition.defaultVersionId === version.id, projectCommit: version.project?.commit ?? '', ...JSON.parse(JSON.stringify(version)) as VideoEditFieldData, ...contents, source: contents.files[contents.entry], definitionId: definition.id, ...(codeMetadata ? JSON.parse(JSON.stringify(readVideoEditCodeParameterMetadata(instance, instance.document, definition.id, version.id))) as VideoEditFieldData : {}) }
  }
  if (!VIDEO_EDIT_TYPES.includes(ref.kind as VideoEditEntityType)) throw new Error('未知剪辑实体类型。')
  const found = videoEditEntityItems(instance.document, ref.kind as VideoEditEntityType).find(item => item.id === childId)
  if (!found) throw new Error('NOT_FOUND：目标不属于此剪辑或已删除。')
  // Sequence projections must not clone the full transcript, clips and captions for a name read.
  const selected = ref.kind === 'video_edit.sequence' && propertyIds?.length
    ? Object.fromEntries(propertyIds.map(id => videoEditDataKey(id.slice(ref.kind.length + 1))).filter(key => key in found).map(key => [key, (found as unknown as VideoEditFieldData)[key]])) : found
  const data = JSON.parse(JSON.stringify(selected)) as VideoEditFieldData
  if (ref.kind === 'video_edit.caption') data.reviewReasons ??= []
  if (ref.kind === 'video_edit.media') {
    const audio = readVideoEditMediaAudio(projectId, childId)
    data.audioAnalysis = audio ? { bpm: audio.bpm, beats: [...audio.beats], onsets: [...audio.onsets], beatsPerBar: audio.beatsPerBar, barOrigin: audio.barOrigin } : null
    data.proxyState = { ...readVideoEditProxyState(projectId, childId) }
    data.musicStructure = JSON.parse(JSON.stringify(readVideoEditMusicStructure(projectId, childId) ?? null)) as JsonValue
    const source = instance.document.media.find(media => media.id === childId)?.recordingCursor
    data.recordingCursorMode = source ? source.cursorBakedIn ? 'clicks' : 'redraw' : 'unavailable'
    delete data.recordingCursor
  }
  if (ref.kind === 'video_edit.sequence') {
    data.captionTrackEnabled ??= true
    data.captionTrackLocked ??= false
    data.motionBlur ??= false
    data.frameBlend ??= false
    data.multicam ??= null
    const transcript = !propertyIds?.length || propertyIds.includes('video_edit.sequence.transcript')
    const silences = !propertyIds?.length || propertyIds.includes('video_edit.sequence.text_silences')
    if (transcript || silences) {
      const composition = videoEditComposition(instance.document, childId)
      if (transcript) data.transcript = videoEditTranscriptWords(composition).map(word => ({ index: word.index, text: word.text, from: word.from, to: word.to, editable: !word.locked && word.granularity === 'word', granularity: word.granularity }))
      if (silences) data.textSilences = resolveVideoEditTextRanges(composition, { kind: 'silence' }).map(range => ({ ...range }))
    }
  }
  if (ref.kind === 'video_edit.clip') {
    const clip = instance.document.sequences.flatMap(sequence => sequence.clips).find(clip => clip.id === childId)!
    const source = instance.document.sequences.find(sequence => sequence.id === instance.document.items.find(item => item.id === clip.itemId)?.sequenceId)
    if (source?.multicam) data.multicamCameraId = clip.multicamCameraId ?? source.multicam.cameras[0].id
    data.motionBlur = clip.motionBlur !== false
    data.enabled = clip.enabled !== false
    Object.assign(data, { graphicObjectIds: clip.graphic?.objects.map(object => object.id) ?? [], effectIds: clip.effects?.map(effect => effect.id) ?? [], adjustmentFromTrack: clip.adjustment?.fromTrack ?? null }, videoEditClipSpeedData(clip))
  }
  if (ref.kind === 'video_edit.item') {
    const item = instance.document.items.find(item => item.id === childId)!
    Object.assign(data, { graphicKind: item.graphic?.objects[0]?.kind ?? null, graphicWidth: item.graphic?.width ?? null, graphicHeight: item.graphic?.height ?? null })
    data.contentQueries = readVideoEditContentQueries(instance, childId)
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
  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }, context?: ApplicationControlAccessContext) {
    if (!listVideoEditInstances().some(owner => owner.document.id === splitVideoEditRef(ref).projectId)) await openVideoEditDocument({ id: splitVideoEditRef(ref).projectId }, { focus: false })
    if (request.propertyIds?.length === 0) { assertVideoEditEntityExists(ref); return { ref, entityType: this.entityType, revisions: { video_edit: videoEditRevision() }, properties: {}, capturedAt: new Date().toISOString() } }
    if (this.entityType === 'video_edit.media' && (!request.propertyIds?.length || request.propertyIds.includes('video_edit.media.proxy_state'))) { const target = splitVideoEditRef(ref); await ensureVideoEditProxyState(target.projectId, target.childId) }
    const needsMetadata = ['video_edit.code_material', 'video_edit.code_version'].includes(this.entityType)
    if (needsMetadata) {
      const { projectId, childId } = splitVideoEditRef(ref); const owner = requireVideoEditInstance(projectId)
      const definition = owner.document.codeMaterials?.find(definition => this.entityType === 'video_edit.code_material' ? definition.id === childId : definition.versions.some(version => version.id === childId))
      if (!definition) throw new Error('NOT_FOUND：代码素材或固定源码版本不存在。')
      await ensureVideoEditCodeParameterMetadata(owner, owner.document, definition.id, this.entityType === 'video_edit.code_material' ? definition.defaultVersionId : childId, context?.signal)
    }
    const fields = request.propertyIds?.length ? VIDEO_EDIT_FIELDS[this.entityType].filter(field => request.propertyIds!.includes(field.propertyId)) : VIDEO_EDIT_FIELDS[this.entityType]
    const data = fieldReadValues(fields, readVideoEditData(ref, needsMetadata, request.propertyIds))
    return { ref, entityType: this.entityType, revisions: { video_edit: videoEditRevision() }, properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(data).filter(([key]) => request.propertyIds!.includes(key))) : data, capturedAt: new Date().toISOString() }
  }
  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    if (!listVideoEditInstances().some(owner => owner.document.id === splitVideoEditRef(ref).projectId)) await openVideoEditDocument({ id: splitVideoEditRef(ref).projectId }, { focus: false })
    const data = readVideoEditData(ref, false, propertyIds)
    return propertyIds.map(propertyId => {
      const field = VIDEO_EDIT_FIELDS[this.entityType].find(item => item.propertyId === propertyId)
      if (!field) throw new Error(`未知属性 ${propertyId}，可用属性：${VIDEO_EDIT_FIELDS[this.entityType].map(item => item.propertyId).join('、')}`)
      const absent = ['video_edit.clip.code_parameters', 'video_edit.clip.code_curves', 'video_edit.clip.code_version_id', 'video_edit.clip.element_overrides', 'video_edit.item.code_parameters', 'video_edit.item.code_curves'].includes(propertyId) && !data.code
      const wrongKind = propertyId === 'video_edit.graphic_object.text_style' && data.kind !== 'text' || propertyId === 'video_edit.clip.text_style' && data.kind !== 'text' || propertyId === 'video_edit.clip.graphic_object_ids' && data.kind !== 'graphic' || propertyId === 'video_edit.clip.adjustment_from_track' && data.kind !== 'adjustment'
      const { projectId, childId } = splitVideoEditRef(ref); const document = requireVideoEditInstance(projectId).document
      const binding = data.code && typeof data.code === 'object' && !Array.isArray(data.code) ? data.code : undefined
      const overrideUnsupported = propertyId.endsWith('.element_overrides') && document.codeMaterials?.find(definition => definition.id === binding?.definitionId)?.versions.find(version => version.id === binding?.versionId)?.languageVersion !== 4
      const noTimeline = !document.sequences.length && ['video_edit.document.timeline_view', 'video_edit.document.program_playback'].includes(propertyId)
      const multicamUnsupported = propertyId === 'video_edit.sequence.multicam' && !data.multicam || propertyId === 'video_edit.clip.multicam_camera_id' && !document.sequences.some(sequence => sequence.multicam && sequence.id === document.items.find(item => item.id === data.itemId)?.sequenceId)
      const roleOwner = propertyId === 'video_edit.clip.audio_role' ? document.sequences.flatMap(sequence => sequence.clips.map(clip => ({ clip, sequence }))).find(value => value.clip.id === childId) : undefined
      const roleUnsupported = roleOwner && (!(roleOwner.clip.kind === 'audio' || roleOwner.clip.kind === 'video' && roleOwner.clip.sourceComponent !== 'video') || !videoEditClipMedia({ ...document, ...roleOwner.sequence }, roleOwner.clip) || videoEditClipMedia({ ...document, ...roleOwner.sequence }, roleOwner.clip)?.hasAudio === false)
      const childOwner = VIDEO_EDIT_COMPOSITE_TYPES.some(type => type === this.entityType) ? videoEditCompositeOwner(document, this.entityType as VideoEditCompositeEntityType, childId) : undefined
      const parameterKey = propertyId.split('.').at(-2)!
      const curveKey = propertyId.endsWith('.keyframes') ? this.entityType === 'video_edit.clip' ? videoEditDataKey(parameterKey) : parameterKey : undefined
      const builtin = childOwner?.kind === 'effect' ? childOwner.effect.builtin : undefined
      const curveReason = curveKey && this.entityType === 'video_edit.effect' && (!builtin || !requireVideoEditBuiltinEffect(builtin.id).params.some(param => param.key === curveKey)) ? '此内置效果没有该参数；代码滤镜请用 curves 源时间曲线。' : curveKey && this.entityType === 'video_edit.clip' && (data.kind === 'adjustment' && curveKey !== 'opacity' || data.kind === 'audio' && curveKey !== 'volume') ? '此片段类型不支持该动画参数。' : undefined
      const captionOwner = this.entityType === 'video_edit.caption' ? document.sequences.find(sequence => sequence.captions?.some(caption => caption.id === childId)) : undefined
      const caption = captionOwner?.captions?.find(value => value.id === childId)
      const locked = captionOwner ? Boolean(captionOwner.captionTrackLocked || caption && videoEditCaptionClipIds(caption).some(id => captionOwner.tracks.find(track => track.index === captionOwner.clips.find(clip => clip.id === id)?.track)?.locked)) : childOwner ? childOwner.clipIds.some(id => childOwner.sequence.tracks.find(track => track.index === childOwner.sequence.clips.find(clip => clip.id === id)?.track)?.locked) : false
      const reasons = overrideUnsupported ? ['元素覆盖需要第三版代码生成素材。'] : noTimeline ? ['没有序列，请先通过序列集合新建序列。'] : multicamUnsupported ? ['请选择多机位源序列或多机位片段。'] : roleUnsupported ? ['只有带声音的音视频片段可以标注声音类型。'] : curveReason ? [curveReason] : absent ? ['此片段没有代码实例参数。'] : wrongKind ? ['此片段类型不支持该操作。'] : locked ? ['所属轨道已锁定。'] : field.writer ? [] : [field.descriptor.readOnlyReason!]
      return { propertyId, readable: true, writable: Boolean(field.writer) && !overrideUnsupported && !noTimeline && !absent && !wrongKind && !locked && !curveReason && !roleUnsupported && !multicamUnsupported, reasons, requiredPermissions: ['video_edit:read'], revisions: { video_edit: videoEditRevision() } }
    })
  }
  async getCollectionAvailability(parent: ApplicationRef) {
    if (!listVideoEditInstances().some(owner => owner.document.id === splitVideoEditRef(parent).projectId)) await openVideoEditDocument({ id: splitVideoEditRef(parent).projectId }, { focus: false })
    assertVideoEditEntityExists(parent)
    const availability = unrestrictedCollectionAvailability(this.entityType, parent, { video_edit: videoEditRevision() }, ['video_edit:write'])
    if (this.entityType === 'video_edit.caption') {
      const { projectId, childId } = splitVideoEditRef(parent)
      if (requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === childId)?.captionTrackLocked) {
        availability.create = { ...availability.create, available: false, reasons: ['字幕轨道已锁定，请先解锁再编辑。'] }
        availability.remove = { ...availability.remove, available: false, reasons: ['字幕轨道已锁定，请先解锁再编辑。'] }
      }
    }
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
        else { if (!clip.graphic.objects.length) removeReason = '此图形没有可移除的对象。' }
      } else if (this.entityType === 'video_edit.tracker') {
        if (!['video', 'image', 'sequence'].includes(clip.kind)) createReason = '请选择视频、图片或嵌套序列片段。'
        else if ((clip.trackers?.length ?? 0) >= 8) createReason = '片段已有 8 个跟踪器，请先删除不用的跟踪器。'
        if (!clip.trackers?.length) removeReason = '没有可移除的跟踪器。'
      } else { if (!clip.effects?.length) removeReason = '片段没有可移除的效果。' }
    }
    if (createReason) availability.create = { ...availability.create, available: false, reasons: [createReason] }
    if (removeReason) availability.remove = { ...availability.remove, available: false, reasons: [removeReason] }
    return availability
  }
}
/** 片子数据与记录：读取前读好引用它的代码声明，剪后时刻、是否剪掉与问题都由解析得出。 */
class VideoEditSceneProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: VideoEditSceneEntityType) {}
  private async open(projectId: string): Promise<void> {
    if (!listVideoEditInstances().some(owner => owner.document.id === projectId)) await openVideoEditDocument({ id: projectId }, { focus: false })
  }
  /** 声明按读取开始时的那份文档读，返回的数据与版本号同属这一份。 */
  private async source(ref: ApplicationRef, declaration = true): Promise<{ source: VideoEditSceneFieldSource; revisions: Record<string, number> }> {
    const target = parseVideoEditSceneRef(ref); await this.open(target.projectId)
    const owner = requireVideoEditInstance(target.projectId); const document = owner.document; const revisions = { video_edit: videoEditRevision() }
    const scene = findVideoEditScene(document, target.sceneId)
    const record = target.recordId === undefined ? undefined : scene.records.find(item => item.id === target.recordId)
    if (target.recordId !== undefined && !record) throw new Error(`NOT_FOUND：片子数据“${scene.name}”里没有记录 ${target.recordId}，请重新列出 ${VIDEO_EDIT_SCENE_RECORD}。`)
    const state = declaration ? await loadVideoEditSceneDeclarations(owner, document, target.sceneId) : { declaration: undefined, block: undefined, notes: [] }
    return { source: { projectId: target.projectId, scene, state, media: videoEditSceneMedia(document), record }, revisions }
  }
  async listEntities(request: { cursor?: string; limit: number }) {
    const all = listVideoEditInstances().flatMap(instance => (instance.document.scenes ?? []).flatMap(scene => this.entityType === VIDEO_EDIT_SCENE ? [videoEditSceneRef(instance.document.id, scene)] : scene.records.map(record => videoEditSceneRecordRef(instance.document.id, scene.id, record))))
    const offset = Math.max(0, Number(request.cursor) || 0)
    return { refs: all.slice(offset, offset + request.limit), nextCursor: offset + request.limit < all.length ? String(offset + request.limit) : null, revisions: { video_edit: videoEditRevision() } }
  }
  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    const { source, revisions } = await this.source(ref, request.propertyIds?.length !== 0)
    const fields = request.propertyIds ? VIDEO_EDIT_SCENE_FIELDS[this.entityType].filter(field => request.propertyIds!.includes(field.propertyId)) : VIDEO_EDIT_SCENE_FIELDS[this.entityType]
    return { ref, entityType: this.entityType, revisions, properties: fieldReadValues(fields, source), capturedAt: new Date().toISOString() }
  }
  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    const { source, revisions } = await this.source(ref)
    const { block } = source.state
    const kinds = source.state.declaration?.schema.kinds
    const kind = source.record && kinds && Object.hasOwn(kinds, source.record.kind) ? kinds[source.record.kind] : undefined
    return propertyIds.map(propertyId => {
      const field = VIDEO_EDIT_SCENE_FIELDS[this.entityType].find(item => item.propertyId === propertyId)
      if (!field) throw new Error(`未知属性 ${propertyId}，可用属性：${VIDEO_EDIT_SCENE_FIELDS[this.entityType].map(item => item.propertyId).join('、')}`)
      const blocked = block !== undefined && propertyId !== `${VIDEO_EDIT_SCENE}.name`
      // 记录类型没有时刻、或时间点记录写结束：这类记录结构上就没有这处位置可改。
      const timing = !blocked && propertyId === `${VIDEO_EDIT_SCENE_RECORD}.start_cut` && !kind?.at ? `${source.record!.kind} 记录没有声明时刻（at），没有位置可改。`
        : !blocked && propertyId === `${VIDEO_EDIT_SCENE_RECORD}.end_cut` && !(kind?.at && (kind.end || kind.duration)) ? `${source.record!.kind} 记录没有起止（只有开始或没有时刻），改开始写 start_cut。` : undefined
      return { propertyId, readable: true, writable: Boolean(field.writer) && !blocked && !timing, reasons: !field.writer ? [field.descriptor.readOnlyReason!] : blocked ? [block] : timing ? [timing] : [], ...(field.writer && blocked ? { blocks: [VIDEO_EDIT_SCENE_DECLARATION_BLOCK] } : {}), requiredPermissions: ['video_edit:read'], revisions }
    })
  }
  async getCollectionAvailability(parent: ApplicationRef) {
    if (this.entityType === VIDEO_EDIT_SCENE) {
      if (parent.kind !== 'video_edit.document') throw new Error(`${VIDEO_EDIT_SCENE} 的父实体是 video_edit.document（剪辑），收到 ${parent.kind}。`)
      await this.open(parent.id)
      const scenes = requireVideoEditInstance(parent.id).document.scenes ?? []
      const availability = unrestrictedCollectionAvailability(this.entityType, parent, { video_edit: videoEditRevision() }, ['video_edit:write'])
      if (scenes.length >= VIDEO_EDIT_SCENE_LIMITS.scenes) availability.create = { ...availability.create, available: false, reasons: [`一份剪辑最多 ${VIDEO_EDIT_SCENE_LIMITS.scenes} 份片子数据。`] }
      if (!scenes.length) availability.remove = { ...availability.remove, available: false, reasons: ['这份剪辑还没有片子数据。'] }
      return availability
    }
    if (parent.kind !== VIDEO_EDIT_SCENE) throw new Error(`${VIDEO_EDIT_SCENE_RECORD} 的父实体是 ${VIDEO_EDIT_SCENE}（片子数据），收到 ${parent.kind}。`)
    const { source, revisions } = await this.source(parent)
    const availability = unrestrictedCollectionAvailability(this.entityType, parent, revisions, ['video_edit:write'])
    const { block } = source.state
    if (block) {
      availability.create = { ...availability.create, available: false, reasons: [block], blocks: [VIDEO_EDIT_SCENE_DECLARATION_BLOCK] }
      availability.remove = { ...availability.remove, available: false, reasons: [block], blocks: [VIDEO_EDIT_SCENE_DECLARATION_BLOCK] }
    } else if (!source.scene.records.length) availability.remove = { ...availability.remove, available: false, reasons: ['这份片子数据还没有记录。'] }
    return availability
  }
}
const SCENE_ENTITY_TEXT: Record<VideoEditSceneEntityType, { title: string; description: string }> = {
  [VIDEO_EDIT_SCENE]: { title: '片子数据', description: '片子数据：代码做的片子里“画什么”的结构化记录（段落、窗口内容时间表、框、组件、镜头落点、剪切；不是镜头检测）。代码版本用 scene 参数声明记录类型与字段含义（读 schema），代码片段的 scene 参数引用它。在 video_edit.document 下新建（name、declaration_source 必填，可带初始 records）或删除；还有代码参数引用的不能删。改数据马上生效，不改代码、不提交、不升级素材，进剪辑撤销栈。逐条读改增删用 video_edit.scene_record；一次要改很多条（超过事务 32 步）就整份写 records。时刻是引用它的代码片段的素材时间（秒，0 = 素材开头），未剪切；剪切本身也是记录，记录读回的 start/end 才是剪后时刻。改完读 issues 核对。' },
  [VIDEO_EDIT_SCENE_RECORD]: { title: '片子数据记录', description: '片子数据里的一条记录。kind 是代码声明的记录类型，values 按 schema.kinds[kind].fields 从严校验，不合法的整次不写并点名记录与字段。特殊语义只看声明的 role：cut 剪切（at 到结束这段剪掉，之后的记录前移；enabled 为 false 时不生效）、segment 段落（挂在它下面的记录随它一起被剪掉）、shot 窗口内容（同一父记录下同类的几项组成取帧时间表）；没写 role 的类型没有特殊语义。直接改 values 时改到的字段自动记进 tuned（手调过，重新生成会保留）；从 tuned 去掉就是恢复自动。start/end 是解析后的剪后时刻（只读），按剪后时刻改位置写 start_cut/end_cut；dropped 表示被剪掉，issues 是这条记录的问题。' },
}
function createVideoEditSceneRegistrations(): ApplicationEntityRegistration[] {
  return VIDEO_EDIT_SCENE_TYPES.map(entityType => ({
    entity: { id: entityType, domain: 'video_edit', version: 1, ...SCENE_ENTITY_TEXT[entityType], refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: entityType === VIDEO_EDIT_SCENE ? ['video_edit.document'] : [VIDEO_EDIT_SCENE], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', entityType),
      collectionWrite: entityType === VIDEO_EDIT_SCENE ? { creatable: true, removable: true, requiredPropertyIds: VIDEO_EDIT_SCENE_REQUIRED, maxItemsPerChange: VIDEO_EDIT_SCENE_LIMITS.scenes } : { creatable: true, removable: true, requiredPropertyIds: VIDEO_EDIT_SCENE_RECORD_REQUIRED, maxItemsPerChange: 128 } },
    properties: fieldDescriptors(VIDEO_EDIT_SCENE_FIELDS[entityType]), provider: new VideoEditSceneProvider(entityType), schemaDocuments: videoEditSceneSchemaDocuments(entityType),
  }))
}
const titles: Record<VideoEditEntityType, string> = { 'video_edit.tracker': '片段跟踪器', 'video_edit.document': '剪辑', 'video_edit.sequence': '剪辑序列', 'video_edit.bin': '素材箱', 'video_edit.item': '素材项', 'video_edit.track': '序列轨道', 'video_edit.clip': '剪辑片段', 'video_edit.annotation': '画面标注', 'video_edit.media': '原路径素材', 'video_edit.source': '源素材预览', 'video_edit.code_material': '原生代码素材', 'video_edit.code_version': '固定源码版本', 'video_edit.marker': '时间标记', 'video_edit.caption': '导出字幕', 'video_edit.graphic_object': '片段图形对象', 'video_edit.effect': '片段效果', 'video_edit.transition': '序列转场', 'video_edit.builtin_effect': '内置效果与过渡目录' }
const sequenceChildren = ['video_edit.clip', 'video_edit.annotation', 'video_edit.track', 'video_edit.marker', 'video_edit.caption', 'video_edit.transition']
const required: Partial<Record<VideoEditEntityType, string[]>> = {
  'video_edit.sequence': ['video_edit.sequence.name'], 'video_edit.bin': ['video_edit.bin.name'], 'video_edit.item': ['video_edit.item.name', 'video_edit.item.kind'],
  'video_edit.clip': ['video_edit.clip.item_id', 'video_edit.clip.kind', 'video_edit.clip.name'], 'video_edit.annotation': ['video_edit.annotation.target', 'video_edit.annotation.frame', 'video_edit.annotation.text'],
  'video_edit.marker': ['video_edit.marker.frame', 'video_edit.marker.name'], 'video_edit.track': ['video_edit.track.kind'], 'video_edit.caption': ['video_edit.caption.start', 'video_edit.caption.duration', 'video_edit.caption.text'],
  'video_edit.code_material': [],
  'video_edit.code_version': ['video_edit.code_version.definition_id'],
  'video_edit.graphic_object': ['video_edit.graphic_object.kind'],
  'video_edit.effect': ['video_edit.effect.definition_id'],
  'video_edit.tracker': ['video_edit.tracker.name', 'video_edit.tracker.method', 'video_edit.tracker.prompts'],
  // 两端片段可只写一端（单侧过渡），由创建时的编辑点校验给出可用端点。
  'video_edit.transition': ['video_edit.transition.duration_frames'],
}
export function createVideoEditRegistrations(): ApplicationEntityRegistration[] {
  return [...VIDEO_EDIT_TYPES.map<ApplicationEntityRegistration>(entityType => ({
    entity: { id: entityType, domain: 'video_edit', version: 2, title: titles[entityType], description: entityType === 'video_edit.sequence' ? '剪辑序列：新项目没有序列。在 video_edit.document 下用通用集合创建，name 必填，省略规格使用已保存的默认值（初始 1920×1080、60 帧）。创建首条序列后自动成为当前序列；可整体撤销。' : entityType === 'video_edit.tracker' ? '视频、图片或嵌套序列片段下的物体跟踪定义：shape 形状遮罩、box 物体框、point 1–4 个特征点或 planar 平面四角，prompts 给素材绝对时间（嵌套为子序列时间）与归一化点/框/四角；新建或纠错后自动在后台跟满片段，读 status 查看进度。效果作用区域、手绘遮罩与其他片段跟随共用结果，导出自动等待。' : entityType === 'video_edit.source' ? '独立源预览会话；定位、播放写入等待真实媒体响应，逐帧观察不改剪辑内容或撤销历史。' : entityType === 'video_edit.builtin_effect' ? '剪辑内置的 GPU 视频效果（模糊、调色、马赛克、暗角、裁剪、抠像等）、音频效果（参数均衡、高通低通、压缩、限幅、去齿音、降噪、混响、音调变换、增益与声道平衡）与过渡（擦除、推动、滑动、缩放、模糊、闪光、圆形划像；音频恒定功率、恒定增益、指数淡化）及参数语义；预览与导出一致。效果用 video_edit.effect 加到片段上（说明以“音频效果”开头的只加声音片段），过渡用 video_edit.transition 放到编辑点上。' : entityType === 'video_edit.effect' ? '片段效果链里的一项：内置效果（definition_id 为 effect:<ID>）或代码滤镜；画面片段上从上到下依次处理画面，声音片段上依次处理声音（只接受音频内置效果）。' : '本地剪辑中的稳定实体，手动与助手共用编辑历史。', refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: entityType === 'video_edit.document' ? [] : ['video_edit.graphic_object', 'video_edit.effect', 'video_edit.tracker'].includes(entityType) ? ['video_edit.clip'] : sequenceChildren.includes(entityType) ? ['video_edit.sequence'] : ['video_edit.document'], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', entityType),
      ...(entityType === 'video_edit.media' ? { writeExclusion: { reason: '素材由正式本地导入或素材库引用服务检测；路径来自用户的文件选择或拖入，或经 import_video_edit_project_files 按项目内相对路径导入。' } } : {}),
      ...(entityType === 'video_edit.builtin_effect' ? { writeExclusion: { reason: VIDEO_EDIT_BUILTIN_CATALOG_READ_ONLY } } : {}),
      ...(required[entityType] ? { collectionWrite: { creatable: true, removable: entityType !== 'video_edit.code_version', requiredPropertyIds: required[entityType]!, maxItemsPerChange: 32 } } : {}),
    }, properties: fieldDescriptors(VIDEO_EDIT_FIELDS[entityType]), provider: new VideoEditProvider(entityType), schemaDocuments: videoEditSchemaDocuments(entityType),
  })), createVideoEditExplanationRegistration(), createCodeComponentRegistration(), ...createCodeProjectRegistrations(), createVideoEditTextPresetRegistration(), createVideoEditEffectPresetRegistration(), createVideoEditPresetRegistration(), createVideoEditSubtitlePresetRegistration(), createVideoEditExportPresetRegistration(), createFontRegistration(), ...createVideoEditStyleRegistrations(), ...createVideoEditSceneRegistrations()]
}
