import type { JsonValue } from '@/core/application-control'
import { videoEditClipMedia, videoEditClipSchema, type VideoEditDocument, type VideoEditClip } from '@/core/videoEdit/document'
import { videoEditTextStyleSchema } from '@/core/videoEdit/text'
import { createVideoEditGraphic, orderVideoEditGraphicObjects } from '@/core/videoEdit/graphics'
import { orderVideoEditEffects, videoEditEffectAccepts, videoEditEffectSchema, videoEditAdjustmentSchema } from '@/core/videoEdit/compositing'
import { videoEditTransitionClipIds, videoEditTransitionEditPoints, videoEditTransitionMedium, videoEditTransitionPreset, videoEditTransitionSchema, videoEditTransitionWindow, VIDEO_EDIT_TRANSITION_PRESETS, type VideoEditTransitionKind } from '@/core/videoEdit/transitions'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { validateVideoEditTransitionParams } from '@/core/videoEdit/transitionParams'
import { codeMaterialInstanceSchema } from '@/core/videoEdit/codeMaterialPersistence'
import type { CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import { makeVideoEditBuiltinEffect, makeVideoEditEffect } from './videoEditCompositing'
import { parseVideoEditBuiltinRefId, validateVideoEditBuiltinParams, videoEditBuiltinEffectMedia, videoEditBuiltinRefId } from '@/core/videoEdit/builtinEffects'
import { videoEditSmartRegionStatusText } from './videoEditSmartRegions'
import { assertVideoEditMaskTrackers, putVideoEditTracker } from './videoEditTrackingEdits'
import { videoEditTrackingRequest, videoEditTrackingStatus, videoEditTrackingStatusText } from './videoEditTracking'
import { isSmartRegionMask, type VideoEditEffectMask } from '@/core/videoEdit/effectMasks'
import { videoEditCurvesSchema, sliceVideoEditClipKeyframes } from '@/core/videoEdit/keyframes'

export const VIDEO_EDIT_COMPOSITE_TYPES = ['video_edit.graphic_object', 'video_edit.effect', 'video_edit.transition', 'video_edit.tracker'] as const
export type VideoEditCompositeEntityType = typeof VIDEO_EDIT_COMPOSITE_TYPES[number]
type Data = Record<string, JsonValue>
export function videoEditGraphicObjectId(clipId: string, objectId: string): string {
  return `graphic:${clipId.length}:${clipId}${objectId}`
}
export function videoEditTrackerEntityId(clipId: string, trackerId: string): string { return `tracker:${clipId.length}:${clipId}${trackerId}` }
function splitObjectId(id: string): [string, string] {
  try {
    if (!id.startsWith('graphic:')) throw new Error()
    const separator = id.indexOf(':', 8); const lengthText = id.slice(8, separator)
    if (!/^[1-9][0-9]{0,2}$/.test(lengthText)) throw new Error()
    const length = Number(lengthText); const start = separator + 1
    const value: [string, string] = [id.slice(start, start + length), id.slice(start + length)]
    if (length > 100 || value.some(part => !part.length || part.length > 100)) throw new Error()
    return value
  } catch { throw new Error('请使用目录返回的完整图形对象引用。') }
}
function clipOwner(document: VideoEditDocument, clipId: string) {
  const sequence = document.sequences.find(sequence => sequence.clips.some(clip => clip.id === clipId))
  const clip = sequence?.clips.find(clip => clip.id === clipId)
  if (!sequence || !clip) throw new Error('NOT_FOUND：所属片段已移除。')
  return { sequence, clip }
}
export function videoEditCompositeOwner(document: VideoEditDocument, type: VideoEditCompositeEntityType, childId: string) {
  if (type === 'video_edit.tracker') {
    const [clipId, trackerId] = splitObjectId(childId.replace(/^tracker:/, 'graphic:')); const owner = clipOwner(document, clipId)
    const tracker = owner.clip.trackers?.find(tracker => tracker.id === trackerId)
    if (!tracker) throw new Error('NOT_FOUND：跟踪器已移除。')
    return { kind: 'tracker' as const, ...owner, tracker, clipIds: [clipId] }
  }
  if (type === 'video_edit.graphic_object') {
    const [clipId, objectId] = splitObjectId(childId); const owner = clipOwner(document, clipId)
    const object = owner.clip.graphic?.objects.find(object => object.id === objectId)
    if (!object) throw new Error('NOT_FOUND：图形对象已移除。')
    return { kind: 'graphic' as const, ...owner, object, clipIds: [clipId] }
  }
  if (type === 'video_edit.effect') {
    const sequence = document.sequences.find(sequence => sequence.clips.some(clip => clip.effects?.some(effect => effect.id === childId)))
    const clip = sequence?.clips.find(clip => clip.effects?.some(effect => effect.id === childId))
    if (!sequence || !clip) throw new Error('NOT_FOUND：效果实例已移除。')
    return { kind: 'effect' as const, sequence, clip, effect: clip.effects!.find(effect => effect.id === childId)!, clipIds: [clip.id] }
  }
  const sequence = document.sequences.find(sequence => sequence.transitions?.some(transition => transition.id === childId))
  const transition = sequence?.transitions?.find(transition => transition.id === childId)
  if (!sequence || !transition) throw new Error('NOT_FOUND：转场已移除。')
  return { kind: 'transition' as const, sequence, transition, clipIds: videoEditTransitionClipIds(transition) }
}
export function videoEditCompositeItems(document: VideoEditDocument, type: VideoEditCompositeEntityType): Array<{ id: string; name: string }> {
  if (type === 'video_edit.tracker') return document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => (clip.trackers ?? []).map(tracker => ({ id: videoEditTrackerEntityId(clip.id, tracker.id), name: tracker.name }))))
  if (type === 'video_edit.graphic_object') return document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => (clip.graphic?.objects ?? []).map(object => ({ id: videoEditGraphicObjectId(clip.id, object.id), name: object.name }))))
  if (type === 'video_edit.effect') return document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => (clip.effects ?? []).map(effect => ({ id: effect.id, name: effect.name }))))
  return document.sequences.flatMap(sequence => (sequence.transitions ?? []).map(transition => ({ id: transition.id, name: videoEditTransitionPreset(transition.kind).name })))
}
export function videoEditCompositeData(document: VideoEditDocument, type: VideoEditCompositeEntityType, childId: string): Data {
  const owner = videoEditCompositeOwner(document, type, childId)
  const common = { sequenceId: owner.sequence.id, ...(owner.kind !== 'transition' ? { clipId: owner.clip.id } : {}) }
  if (owner.kind === 'tracker') {
    const request = videoEditTrackingRequest(document, owner.sequence.frameRate, owner.clip, owner.tracker)
    return JSON.parse(JSON.stringify({ ...common, ...owner.tracker, status: videoEditTrackingStatusText(videoEditTrackingStatus(request?.definition), request?.range) })) as Data
  }
  if (owner.kind === 'graphic') return JSON.parse(JSON.stringify({ ...common, ...owner.object, curves: owner.object.curves ?? {} })) as Data
  if (owner.kind === 'effect') {
    const { code, builtin, ...effect } = owner.effect
    // 内置效果：definition_id 读出 `effect:<ID>`，parameters 是存下的意图量纲参数（缺的键按默认值渲染）；没有源码版本与关键帧。
    // 作用区域（4.7d）：mask 为空表示整个画面；region_status 是后台分析的当前状态。
    const region = { mask: owner.effect.mask ?? null, regionStatus: videoEditSmartRegionStatusText(document, owner.sequence.frameRate, owner.clip, owner.effect) }
    if (builtin) return JSON.parse(JSON.stringify({ ...common, ...effect, ...region, definitionId: videoEditBuiltinRefId(builtin.id), versionId: '', parameters: builtin.params, curves: {}, frameCurves: builtin.curves ?? {} })) as Data
    return JSON.parse(JSON.stringify({ ...common, ...effect, ...region, definitionId: code!.definitionId, versionId: code!.versionId, parameters: code!.parameters, curves: code!.curves ?? {} })) as Data
  }
  // 过渡参数：没有存参数时读出空对象（全部按默认值）；种类与参数见 video_edit.builtin_effect 的 transition:<种类>。
  return JSON.parse(JSON.stringify({ ...common, ...owner.transition, parameters: owner.transition.parameters ?? {} })) as Data
}
/** Draft operations use the same factories and full domain validator as manual
 * creation. No publication or history occurs until the caller proves the draft. */
export function updateVideoEditCompositeEntity(document: VideoEditDocument, type: VideoEditCompositeEntityType, childId: string, data: Data): VideoEditDocument {
  const owner = videoEditCompositeOwner(document, type, childId)
  if (owner.kind === 'tracker') {
    putVideoEditTracker(document, owner.clip, { id: owner.tracker.id, name: data.name, method: data.method, prompts: data.prompts })
  } else if (owner.kind === 'graphic') {
    Object.assign(owner.object, { name: data.name, parameters: data.parameters, curves: data.curves, textStyle: data.textStyle ?? undefined, visible: data.visible })
  } else if (owner.kind === 'effect') {
    const builtin = owner.effect.builtin
    if (builtin) {
      if (data.versionId) throw new Error('内置效果没有源码版本，version_id 保持为空。')
      if (data.curves && typeof data.curves === 'object' && Object.keys(data.curves).length) throw new Error('内置效果请写 parameters.<参数名>.keyframes，time 为片段内帧；curves 只用于代码滤镜源时间曲线。')
      // 整体写入：写什么存什么（读回与写入一致），没写的键回到默认值
      const params = validateVideoEditBuiltinParams(builtin.id, (data.parameters ?? {}) as Record<string, unknown>)
      const mask = data.mask ?? undefined
      // 删除跟踪器后引用可落空；只在实际写入作用区域时校验，改名称等属性仍可进行。
      if (JSON.stringify(mask) !== JSON.stringify(owner.effect.mask)) assertMaskClip(document, owner.clip, mask as VideoEditEffectMask | undefined)
      const curves = videoEditCurvesSchema.parse(data.frameCurves ?? {})
      const next = videoEditEffectSchema.parse({ id: owner.effect.id, name: data.name, enabled: data.enabled, amount: data.amount, builtin: { id: builtin.id, params, ...(Object.keys(curves).length ? { curves } : {}) }, ...(mask ? { mask } : {}) })
      delete owner.effect.mask; Object.assign(owner.effect, next)
    } else {
      if (data.frameCurves && typeof data.frameCurves === 'object' && Object.keys(data.frameCurves).length) throw new Error('代码滤镜请使用 curves 源时间曲线；parameters.<参数>.keyframes 只用于内置效果。')
      const next = videoEditEffectSchema.parse({ id: owner.effect.id, name: data.name, enabled: data.enabled, amount: data.amount, code: { definitionId: owner.effect.code!.definitionId, versionId: data.versionId, parameters: data.parameters, curves: data.curves }, ...(data.mask ? { mask: data.mask } : {}) })
      Object.assign(owner.effect, next)
    }
  } else {
    const kind = (data.kind ?? owner.transition.kind) as VideoEditTransitionKind
    if (!VIDEO_EDIT_TRANSITION_PRESETS.some(preset => preset.kind === kind)) throw new Error(`没有过渡种类 ${String(kind)}，可用：${VIDEO_EDIT_TRANSITION_PRESETS.map(preset => preset.kind).join('、')}。`)
    if (videoEditTransitionMedium(kind) !== videoEditTransitionMedium(owner.transition.kind)) throw new Error(`过渡种类只能换成同一媒介的；当前是${videoEditTransitionMedium(owner.transition.kind) === 'audio' ? '音频' : '视频'}过渡，可用种类：${VIDEO_EDIT_TRANSITION_PRESETS.filter(preset => preset.medium === videoEditTransitionMedium(owner.transition.kind)).map(preset => preset.kind).join('、')}。`)
    // 参数整体写入（写什么存什么）；只换种类、参数没动时旧参数不再适用，按新种类的默认值
    const raw = (data.parameters ?? {}) as Record<string, unknown>
    const untouched = JSON.stringify(raw) === JSON.stringify(owner.transition.parameters ?? {})
    const parameters = kind !== owner.transition.kind && untouched ? {} : validateVideoEditTransitionParams(kind, videoEditTransitionPreset(kind).name, raw)
    const next = videoEditTransitionSchema.parse({ ...owner.transition, kind, durationFrames: data.durationFrames, alignment: data.alignment ?? undefined, framesBeforeCut: data.framesBeforeCut ?? undefined, parameters: Object.keys(parameters).length ? parameters : undefined })
    if (!next.parameters) delete next.parameters
    if (next.alignment === 'center') delete next.alignment
    if (next.alignment !== 'custom') delete next.framesBeforeCut
    Object.keys(owner.transition).forEach(key => { delete (owner.transition as Record<string, unknown>)[key] }); Object.assign(owner.transition, next)
  }
  return document
}
export function createVideoEditCompositeEntity(document: VideoEditDocument, type: VideoEditCompositeEntityType, parentId: string, values: Data, read: CodeMaterialMetadataReader): string {
  if (type === 'video_edit.transition') {
    const sequence = document.sequences.find(sequence => sequence.id === parentId)
    if (!sequence) throw new Error('NOT_FOUND：所属序列已移除。')
    // 两端可只写一端（单侧过渡，与时间线上拖到片段一端的行为一致）；空字符串视为没写。
    const endpoints = { ...values }
    for (const key of ['leftClipId', 'rightClipId']) if (endpoints[key] === '' || endpoints[key] === null) delete endpoints[key]
    const transition = videoEditTransitionSchema.parse({ id: crypto.randomUUID(), kind: 'cross_dissolve', ...endpoints })
    if (transition.parameters && !Object.keys(transition.parameters).length) delete transition.parameters
    assertTransitionEndpoints(sequence, transition)
    ;(sequence.transitions ??= []).push(transition); return transition.id
  }
  const { clip } = clipOwner(document, parentId)
  if (type === 'video_edit.tracker') {
    const tracker = putVideoEditTracker(document, clip, { id: crypto.randomUUID(), ...values })
    return videoEditTrackerEntityId(clip.id, tracker.id)
  }
  if (type === 'video_edit.graphic_object') {
    if (!clip.graphic) throw new Error('请选择结构化图形片段。')
    if (!['rect', 'ellipse', 'text'].includes(String(values.kind))) throw new Error('图形对象需要矩形、椭圆或文字类型。')
    const object = createVideoEditGraphic(values.kind as 'rect' | 'ellipse' | 'text', clip.graphic.width, clip.graphic.height).objects[0]
    if (values.name !== undefined) object.name = String(values.name)
    if (values.textStyle !== undefined) object.textStyle = values.textStyle === null ? undefined : videoEditTextStyleSchema.parse(values.textStyle)
    if (values.visible !== undefined) { if (typeof values.visible !== 'boolean') throw new Error('visible须为布尔值。'); object.visible = values.visible }
    if (values.parameters !== undefined) object.parameters = { ...object.parameters, ...codeMaterialInstanceSchema.shape.parameters.parse(values.parameters) }
    if (values.curves !== undefined) object.curves = codeMaterialInstanceSchema.shape.curves.parse(values.curves)
    clip.graphic.objects.push(object); return videoEditGraphicObjectId(clip.id, object.id)
  }
  if (values.definitionId === undefined || typeof values.definitionId !== 'string') throw new Error('请提供 definition_id：内置效果写 effect:<ID>（如画面 effect:gaussian_blur、声音 effect:noise_reduction，完整目录见 video_edit.builtin_effect），代码滤镜写滤镜源码定义 ID。')
  const builtinId = parseVideoEditBuiltinRefId(values.definitionId)
  const media = builtinId ? videoEditBuiltinEffectMedia(builtinId) : 'video'
  if (!videoEditEffectAccepts(media, clip)) throw new Error(media === 'audio' ? `音频效果只能加到声音片段，片段“${clip.name}”不是声音片段。` : `片段“${clip.name}”是声音片段，只能加音频效果（video_edit.builtin_effect 里说明以“音频效果”开头的 effect:<ID>，如 effect:noise_reduction）。`)
  if (builtinId) {
    if (values.versionId) throw new Error('内置效果没有源码版本，请不要提供 version_id。')
    if (values.curves && typeof values.curves === 'object' && Object.keys(values.curves).length) throw new Error('内置效果请写 parameters.<参数名>.keyframes，time 为片段内帧；curves 只用于代码滤镜源时间曲线。')
    const effect = makeVideoEditBuiltinEffect(builtinId, (values.parameters ?? {}) as Record<string, unknown>, values.name !== undefined ? String(values.name) : undefined, true)
    if (values.enabled !== undefined) effect.enabled = videoEditEffectSchema.shape.enabled.parse(values.enabled)
    if (values.amount !== undefined) effect.amount = videoEditEffectSchema.shape.amount.parse(values.amount)
    if (values.frameCurves !== undefined) effect.builtin!.curves = videoEditCurvesSchema.parse(values.frameCurves)
    Object.assign(effect, videoEditEffectSchema.parse(effect))
    if (values.mask) {
      assertMaskClip(document, clip, values.mask as VideoEditEffectMask)
      Object.assign(effect, videoEditEffectSchema.parse({ ...effect, mask: values.mask }))
    }
    (clip.effects ??= []).push(effect); return effect.id
  }
  const effect = makeVideoEditEffect(document, { definitionId: values.definitionId, ...(values.versionId !== undefined ? { versionId: String(values.versionId) } : {}), ...(values.name !== undefined ? { name: String(values.name) } : {}), ...(values.parameters !== undefined ? { parameters: codeMaterialInstanceSchema.shape.parameters.parse(values.parameters) } : {}) }, read)
  if (values.enabled !== undefined) effect.enabled = videoEditEffectSchema.shape.enabled.parse(values.enabled)
  if (values.amount !== undefined) effect.amount = videoEditEffectSchema.shape.amount.parse(values.amount)
  if (values.curves !== undefined) effect.code!.curves = codeMaterialInstanceSchema.shape.curves.parse(values.curves)
  ;(clip.effects ??= []).push(effect); return effect.id
}
/** 智能区域只能用在视频、图片片段上：要逐帧分析素材画面（4.7d）；手绘遮罩（4.10）是几何，任何画面片段都能用。 */
function assertMaskClip(document: VideoEditDocument, clip: VideoEditClip, mask: VideoEditEffectMask | undefined): void {
  assertVideoEditMaskTrackers(clip, mask)
  if (!isSmartRegionMask(mask)) return
  const media = videoEditClipMedia(document, clip)
  if (!media || (media.kind !== 'video' && media.kind !== 'image')) throw new Error(`片段“${clip.name}”不是视频或图片片段，智能区域只能用在视频、图片片段上；文字、图形、代码与调整图层上的效果请作用于整个画面（mask 写 null），或用手绘遮罩（region_id: shapes）。`)
}
export function removeVideoEditCompositeEntities(document: VideoEditDocument, type: VideoEditCompositeEntityType, parentId: string, ids: string[]): void {
  for (const id of ids) {
    const owner = videoEditCompositeOwner(document, type, id)
    if ((owner.kind === 'transition' ? owner.sequence.id : owner.clip.id) !== parentId) throw new Error('目标不属于此集合。')
  }
  if (type === 'video_edit.transition') {
    const sequence = document.sequences.find(sequence => sequence.id === parentId)!
    sequence.transitions = sequence.transitions!.filter(transition => !ids.includes(transition.id))
  } else {
    const { clip } = clipOwner(document, parentId)
    if (type === 'video_edit.tracker') clip.trackers = clip.trackers?.filter(tracker => !ids.includes(videoEditTrackerEntityId(clip.id, tracker.id)))
    else if (type === 'video_edit.graphic_object') clip.graphic!.objects = clip.graphic!.objects.filter(object => !ids.includes(videoEditGraphicObjectId(clip.id, object.id)))
    else clip.effects = clip.effects!.filter(effect => !ids.includes(effect.id))
  }
}
export function updateVideoEditClipStructure(clip: VideoEditClip, data: Data, keys: string[]): VideoEditClip {
  if (keys.includes('graphicObjectIds')) {
    if (!clip.graphic) throw new Error('此片段没有图形对象。')
    clip.graphic.objects = orderVideoEditGraphicObjects(clip.graphic.objects, data.graphicObjectIds as string[])
  }
  if (keys.includes('effectIds')) {
    clip.effects = orderVideoEditEffects(clip.effects ?? [], data.effectIds as string[])
  }
  if (keys.includes('adjustmentFromTrack')) {
    if (clip.kind !== 'adjustment') throw new Error('此片段不是调整图层。')
    clip.adjustment = { fromTrack: videoEditAdjustmentSchema.shape.fromTrack.parse(data.adjustmentFromTrack) }
  }
  const plain = Object.fromEntries(Object.entries(data).filter(([key]) => !['graphicObjectIds', 'effectIds', 'adjustmentFromTrack'].includes(key)))
  // `data` is the full readback copy; a cleared optional reference (link/group/source component) is absent here and must stay absent.
  const parsed = videoEditClipSchema.parse({ ...plain, graphic: clip.graphic, effects: clip.effects, adjustment: clip.adjustment })
  if (parsed.duration !== clip.duration && !keys.some(key => key.endsWith('.keyframes'))) return { ...sliceVideoEditClipKeyframes({ ...parsed, duration: clip.duration }, 0, parsed.duration), duration: parsed.duration }
  return parsed
}
/**
 * 助手创建过渡时校验端点：至少写一端，片段存在、媒介匹配、放得下。不成立时列出这个序列能放这种过渡的编辑点，
 * 让调用方直接改用（与时间线拖放、Shift+D 同一套编辑点规则）。
 */
function assertTransitionEndpoints(sequence: VideoEditSequence, transition: ReturnType<typeof videoEditTransitionSchema.parse>): void {
  const medium = videoEditTransitionMedium(transition.kind)
  const available = (): string => {
    const label = (id: string): string => `${id}（${sequence.clips.find(clip => clip.id === id)?.name ?? ''}）`
    const points = videoEditTransitionEditPoints(sequence, medium).slice(0, 24).map(point => point.leftClipId && point.rightClipId ? `left_clip_id=${label(point.leftClipId)} + right_clip_id=${label(point.rightClipId)}` : point.leftClipId ? `只写 left_clip_id=${label(point.leftClipId)}（出点淡出）` : `只写 right_clip_id=${label(point.rightClipId!)}（入点淡入）`)
    return points.length ? `可用的编辑点：${points.join('；')}` : `这个序列没有能放${medium === 'audio' ? '音频' : '视频'}过渡的片段（${medium === 'audio' ? '音频过渡挂声音片段' : '视频过渡挂画面片段'}）`
  }
  if (!transition.leftClipId && !transition.rightClipId) throw new Error(`请至少写 left_clip_id 或 right_clip_id 其中一个。${available()}`)
  try { videoEditTransitionWindow(sequence, transition) } catch (error) { throw new Error(`${error instanceof Error ? error.message : '过渡端点无效。'}${available()}`) }
}
