import type { JsonValue } from '@/core/application-control'
import { videoEditClipSchema, type VideoEditDocument, type VideoEditClip } from '@/core/videoEdit/document'
import { createVideoEditGraphic, orderVideoEditGraphicObjects } from '@/core/videoEdit/graphics'
import { orderVideoEditEffects, videoEditEffectSchema, videoEditAdjustmentSchema } from '@/core/videoEdit/compositing'
import { videoEditTransitionClipIds, videoEditTransitionPreset, videoEditTransitionSchema } from '@/core/videoEdit/transitions'
import { codeMaterialInstanceSchema } from '@/core/videoEdit/codeMaterialPersistence'
import type { CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import { makeVideoEditBuiltinEffect, makeVideoEditEffect } from './videoEditCompositing'
import { parseVideoEditBuiltinRefId, validateVideoEditBuiltinParams, videoEditBuiltinRefId } from '@/core/videoEdit/builtinEffects'

export const VIDEO_EDIT_COMPOSITE_TYPES = ['video_edit.graphic_object', 'video_edit.effect', 'video_edit.transition'] as const
export type VideoEditCompositeEntityType = typeof VIDEO_EDIT_COMPOSITE_TYPES[number]
type Data = Record<string, JsonValue>
export function videoEditGraphicObjectId(clipId: string, objectId: string): string {
  return `graphic:${clipId.length}:${clipId}${objectId}`
}
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
  if (type === 'video_edit.graphic_object') return document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => (clip.graphic?.objects ?? []).map(object => ({ id: videoEditGraphicObjectId(clip.id, object.id), name: object.name }))))
  if (type === 'video_edit.effect') return document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => (clip.effects ?? []).map(effect => ({ id: effect.id, name: effect.name }))))
  return document.sequences.flatMap(sequence => (sequence.transitions ?? []).map(transition => ({ id: transition.id, name: videoEditTransitionPreset(transition.kind).name })))
}
export function videoEditCompositeData(document: VideoEditDocument, type: VideoEditCompositeEntityType, childId: string): Data {
  const owner = videoEditCompositeOwner(document, type, childId)
  const common = { sequenceId: owner.sequence.id, ...(owner.kind !== 'transition' ? { clipId: owner.clip.id } : {}) }
  if (owner.kind === 'graphic') return JSON.parse(JSON.stringify({ ...common, ...owner.object, curves: owner.object.curves ?? {} })) as Data
  if (owner.kind === 'effect') {
    const { code, builtin, ...effect } = owner.effect
    // 内置效果：definition_id 读出 `effect:<ID>`，parameters 是存下的意图量纲参数（缺的键按默认值渲染）；没有源码版本与关键帧。
    if (builtin) return JSON.parse(JSON.stringify({ ...common, ...effect, definitionId: videoEditBuiltinRefId(builtin.id), versionId: '', parameters: builtin.params, curves: {} })) as Data
    return JSON.parse(JSON.stringify({ ...common, ...effect, definitionId: code!.definitionId, versionId: code!.versionId, parameters: code!.parameters, curves: code!.curves ?? {} })) as Data
  }
  return { ...common, ...owner.transition }
}
/** Draft operations use the same factories and full domain validator as manual
 * creation. No publication or history occurs until the caller proves the draft. */
export function updateVideoEditCompositeEntity(document: VideoEditDocument, type: VideoEditCompositeEntityType, childId: string, data: Data): VideoEditDocument {
  const owner = videoEditCompositeOwner(document, type, childId)
  if (owner.kind === 'graphic') {
    Object.assign(owner.object, { name: data.name, parameters: data.parameters, curves: data.curves })
  } else if (owner.kind === 'effect') {
    const builtin = owner.effect.builtin
    if (builtin) {
      if (data.versionId) throw new Error('内置效果没有源码版本，version_id 保持为空。')
      if (data.curves && typeof data.curves === 'object' && Object.keys(data.curves).length) throw new Error('内置效果暂不支持关键帧，请直接写 parameters。')
      // 整体写入：写什么存什么（读回与写入一致），没写的键回到默认值
      const params = validateVideoEditBuiltinParams(builtin.id, (data.parameters ?? {}) as Record<string, unknown>)
      Object.assign(owner.effect, videoEditEffectSchema.parse({ id: owner.effect.id, name: data.name, enabled: data.enabled, amount: data.amount, builtin: { id: builtin.id, params } }))
    } else {
      const next = videoEditEffectSchema.parse({ id: owner.effect.id, name: data.name, enabled: data.enabled, amount: data.amount, code: { definitionId: owner.effect.code!.definitionId, versionId: data.versionId, parameters: data.parameters, curves: data.curves } })
      Object.assign(owner.effect, next)
    }
  } else {
    const next = videoEditTransitionSchema.parse({ ...owner.transition, durationFrames: data.durationFrames, alignment: data.alignment ?? undefined, framesBeforeCut: data.framesBeforeCut ?? undefined })
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
    const transition = videoEditTransitionSchema.parse({ id: crypto.randomUUID(), kind: 'cross_dissolve', ...values })
    ;(sequence.transitions ??= []).push(transition); return transition.id
  }
  const { clip } = clipOwner(document, parentId)
  if (type === 'video_edit.graphic_object') {
    if (!clip.graphic) throw new Error('请选择结构化图形片段。')
    if (!['rect', 'ellipse', 'text'].includes(String(values.kind))) throw new Error('图形对象需要矩形、椭圆或文字类型。')
    const object = createVideoEditGraphic(values.kind as 'rect' | 'ellipse' | 'text', clip.graphic.width, clip.graphic.height).objects[0]
    if (values.name !== undefined) object.name = String(values.name)
    if (values.parameters !== undefined) object.parameters = { ...object.parameters, ...codeMaterialInstanceSchema.shape.parameters.parse(values.parameters) }
    if (values.curves !== undefined) object.curves = codeMaterialInstanceSchema.shape.curves.parse(values.curves)
    clip.graphic.objects.push(object); return videoEditGraphicObjectId(clip.id, object.id)
  }
  if (clip.kind === 'audio') throw new Error('音频片段不能添加画面效果。')
  if (values.definitionId === undefined || typeof values.definitionId !== 'string') throw new Error('请提供 definition_id：内置效果写 effect:<ID>（如 effect:gaussian_blur，完整目录见 video_edit.builtin_effect），代码滤镜写滤镜源码定义 ID。')
  const builtinId = parseVideoEditBuiltinRefId(values.definitionId)
  if (builtinId) {
    if (values.versionId) throw new Error('内置效果没有源码版本，请不要提供 version_id。')
    if (values.curves && typeof values.curves === 'object' && Object.keys(values.curves).length) throw new Error('内置效果暂不支持关键帧。')
    const effect = makeVideoEditBuiltinEffect(builtinId, (values.parameters ?? {}) as Record<string, unknown>, values.name !== undefined ? String(values.name) : undefined, true)
    if (values.enabled !== undefined) effect.enabled = videoEditEffectSchema.shape.enabled.parse(values.enabled)
    if (values.amount !== undefined) effect.amount = videoEditEffectSchema.shape.amount.parse(values.amount)
    ;(clip.effects ??= []).push(effect); return effect.id
  }
  const effect = makeVideoEditEffect(document, { definitionId: values.definitionId, ...(values.versionId !== undefined ? { versionId: String(values.versionId) } : {}), ...(values.name !== undefined ? { name: String(values.name) } : {}), ...(values.parameters !== undefined ? { parameters: codeMaterialInstanceSchema.shape.parameters.parse(values.parameters) } : {}) }, read)
  if (values.enabled !== undefined) effect.enabled = videoEditEffectSchema.shape.enabled.parse(values.enabled)
  if (values.amount !== undefined) effect.amount = videoEditEffectSchema.shape.amount.parse(values.amount)
  if (values.curves !== undefined) effect.code!.curves = codeMaterialInstanceSchema.shape.curves.parse(values.curves)
  ;(clip.effects ??= []).push(effect); return effect.id
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
    if (type === 'video_edit.graphic_object') clip.graphic!.objects = clip.graphic!.objects.filter(object => !ids.includes(videoEditGraphicObjectId(clip.id, object.id)))
    else clip.effects = clip.effects!.filter(effect => !ids.includes(effect.id))
  }
}
export function updateVideoEditClipStructure(clip: VideoEditClip, data: Data, keys: string[]): VideoEditClip {
  if (keys.includes('graphicObjectIds')) {
    if (!clip.graphic) throw new Error('此片段没有图形对象。')
    clip.graphic.objects = orderVideoEditGraphicObjects(clip.graphic.objects, data.graphicObjectIds as string[])
  }
  if (keys.includes('effectIds')) {
    if (clip.kind === 'audio') throw new Error('音频片段不能添加画面效果。')
    clip.effects = orderVideoEditEffects(clip.effects ?? [], data.effectIds as string[])
  }
  if (keys.includes('adjustmentFromTrack')) {
    if (clip.kind !== 'adjustment') throw new Error('此片段不是调整图层。')
    clip.adjustment = { fromTrack: videoEditAdjustmentSchema.shape.fromTrack.parse(data.adjustmentFromTrack) }
  }
  const plain = Object.fromEntries(Object.entries(data).filter(([key]) => !['graphicObjectIds', 'effectIds', 'adjustmentFromTrack'].includes(key)))
  // `data` is the full readback copy; a cleared optional reference (link/group/source component) is absent here and must stay absent.
  return videoEditClipSchema.parse({ ...plain, graphic: clip.graphic, effects: clip.effects, adjustment: clip.adjustment })
}
