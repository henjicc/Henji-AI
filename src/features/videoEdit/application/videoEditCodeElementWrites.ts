import { codeEditKey, recordVideoEditCodeEdits, type CodeEditActor } from '@/core/videoEdit/codeEdits'
import { assertCodeElementOverrideAllowed, codeElementOverrideGeometryKeys, codeElementOverrideSchema, codeElementOverrideValuesSchema, evaluateCodeElementOverride, readCodeElementOverride, type CodeElementOverride, type CodeElementOverrideKey } from '@/core/videoEdit/codeElementOverrides'
import { authorEffectEnvironmentForClip, codeElementAddedEffectKeys, validateAuthorElementEffectOverrides, type AuthorElementEffectState } from '@/core/videoEdit/authorEffects'
import { CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import type { AuthorElementObservation } from '@/core/videoEdit/codeAuthorProgram'
import { codeMaterialVersion as materialVersion } from '@/core/videoEdit/codeMaterialDocument'
import { prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import { jsonEqual } from '@/core/jsonEqual'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { readCodeAuthorTextBinding } from '@/core/videoEdit/codeAuthorTextBinding'
import { readVideoEditCodeProgram } from './videoEditCodeState'
import { videoEditCodeElementFrames } from './videoEditCodeElements'
import { editVideoProject, requireVideoEditInstance, updateVideoEditGesture, type VideoEditGesture } from './videoEditService'
import { readVideoEditCodeEditor, type VideoEditCodeTarget } from './videoEditCodeParameters'

// 代码元素的读回、整组写入与修改记录；实体层与片段整体写入只依赖这里，不经过助手交接与批注（那些在 videoEditCodeElementEditing）。
export interface VideoEditCodeElementTarget extends VideoEditCodeTarget { elementId: string }
export function resolveVideoEditCodeElementClip(target: VideoEditCodeElementTarget, document = requireVideoEditInstance(target.projectId).document) {
  const sequence = document.sequences.find(value => value.id === target.sequenceId)
  const clip = sequence?.clips.find(value => value.id === target.clipId)
  if (!sequence || clip?.kind !== 'code' || !clip.code || clip.code.versionId !== target.versionId || target.effectId) throw new Error('原代码元素或源码版本已改变，请重新选择。')
  return { sequence, clip }
}
export function readVideoEditCodeElementEdit(target: VideoEditCodeElementTarget) {
  const owner = requireVideoEditInstance(target.projectId); const { sequence, clip } = resolveVideoEditCodeElementClip(target)
  const time = videoEditClipSourceTimeAt(clip, Math.max(0, Math.min(clip.duration - 1, owner.frame - clip.start)), sequence.frameRate)
  const entry = videoEditCodeElementFrames(owner, sequence.id, Math.max(clip.start, Math.min(clip.start + clip.duration - 1, owner.frame))).get(clip.id)
  const element = entry?.index.byId.get(target.elementId)
  const program = readVideoEditCodeProgram(owner, owner.document, clip.code!)
  const stored = readCodeElementOverride(clip.elementOverrides, target.elementId) ?? {}
  // 源码后来用了追加项已占的 key：按当前帧的代码效果给追加项换成不冲突的 key，与读回一致；写入时落盘并移动修改记录。
  const codeKeys = element && stored.addedEffects ? new Set(effectStatesOf(element.author).filter(state => !state.added && !state.missing).map(state => state.key)) : undefined
  const addedKeys = codeKeys ? codeElementAddedEffectKeys(codeKeys, stored.addedEffects!) : undefined
  const renamedAddedKeys = addedKeys ? stored.addedEffects!.flatMap((effect, index) => effect.key === addedKeys[index] ? [] : [[effect.key, addedKeys[index]] as [string, string]]) : []
  const override: CodeElementOverride = renamedAddedKeys.length ? { ...stored, addedEffects: stored.addedEffects!.map((effect, index) => ({ ...effect, key: addedKeys![index] })) } : stored
  const editor = readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId)
  const textBinding = readCodeAuthorTextBinding(element?.author, editor.metadata.parameters, editor.parameters)
  return { owner, sequence, clip, entry, element, program, override, renamedAddedKeys, values: evaluateCodeElementOverride(override, time), time, textBinding, parameters: editor.parameters }
}
/**
 * 元素是不是调整层：有当前帧观察时以观察为准；没有观察时按源码里静态声明的图层（对象写了 adjust 且作者接口支持调整层），
 * 不必为判断可写性先把播放头移到它可见的帧。数据生成、当前帧也没有观察的图层返回 undefined。
 */
export function videoEditCodeElementKind(current: Pick<ReturnType<typeof readVideoEditCodeElementEdit>, 'element' | 'program'>, elementId: string): 'adjust' | 'layer' | undefined {
  if (current.element) return current.element.author.kind ?? 'layer'
  const locations = current.program.bundle.locations
  if (!Object.hasOwn(locations.layers, elementId)) return undefined
  return current.program.apiVersion >= CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION && locations.adjustLayerIds?.includes(elementId) ? 'adjust' : 'layer'
}

export type VideoEditCodeElementGroups = {
  transform?: Pick<CodeElementOverride, CodeElementOverrideKey | 'curves' | 'motionBlur'>
  properties?: { values: Record<string, unknown>; curves?: import('@/core/videoEdit/codeMaterialAnimation').CodeMaterialCurves }
  effects?: Pick<CodeElementOverride, 'effects' | 'addedEffects'>
}
export function videoEditCodeElementEffectStates(current: ReturnType<typeof readVideoEditCodeElementEdit>): AuthorElementEffectState[] {
  return current.element ? effectStatesOf(current.element.author) : []
}
function effectStatesOf(author: AuthorElementObservation): AuthorElementEffectState[] {
  if (author.effectStates) return author.effectStates
  // 早于效果身份的观察只有展开后的效果列表：按 key 归并，风格件成员合成一项。
  const states = new Map<string, AuthorElementEffectState>()
  for (const effect of author.effects ?? []) if (effect.source !== 'pose.blur') {
    const key = effect.key ?? (effect.look ? `look:${effect.look}` : effect.id)
    if (!states.has(key)) states.set(key, { key, id: effect.look ? 'look' : effect.id, ...(effect.look ? { name: effect.look } : {}), codeValues: effect.look ? {} : effect.params, values: effect.look ? {} : effect.params, enabled: true, added: false, missing: false, overridden: [] })
  }
  return [...states.values()]
}
/** 片段整体覆盖与元素分组写入共用严格校验；只校验这次改动的项，代码里已没有的旧覆盖可以原样保留或删除。 */
export function validateVideoEditElementEffectWrite(target: VideoEditCodeElementTarget, value: CodeElementOverride): void {
  const owner = requireVideoEditInstance(target.projectId), { clip } = resolveVideoEditCodeElementClip(target)
  const stored = readCodeElementOverride(clip.elementOverrides, target.elementId) ?? {}
  const changes = (previous: CodeElementOverride) => ({
    effects: Object.fromEntries(Object.entries(value.effects ?? {}).filter(([key, patch]) => !(previous.effects && Object.hasOwn(previous.effects, key) && jsonEqual(patch, previous.effects[key])))),
    addedEffects: value.addedEffects?.filter(effect => !jsonEqual(effect, previous.addedEffects?.find(item => item.key === effect.key))),
  })
  if (!Object.keys(changes(stored).effects).length && !changes(stored).addedEffects?.length) return
  // 与读回同一份覆盖比较：追加项只是换成了不冲突的 key 不算改动。
  const current = readVideoEditCodeElementEdit(target)
  const { effects, addedEffects } = changes(current.override)
  if (!Object.keys(effects).length && !addedEffects?.length) return
  if (!current.element) throw new Error(`当前帧没有元素「${target.elementId}」的观察结果：把播放头移到它可见的帧并取帧观察后再改效果；已有改动仍保留。`)
  // 保留下来的追加效果同样占用 key，与本次新增的一起检查重名。
  const kept = (value.addedEffects ?? []).filter(effect => !addedEffects?.includes(effect)).map(effect => ({ key: effect.key, id: effect.id, codeValues: {}, values: {}, overridden: [], enabled: true, added: true, missing: false }))
  const code = videoEditCodeElementEffectStates(current).filter(state => !state.added && !state.missing)
  validateAuthorElementEffectOverrides({ effects, addedEffects }, [...code, ...kept], authorEffectEnvironmentForClip(owner.document, clip), videoEditCodeElementKind(current, target.elementId) === 'adjust' ? 'frame' : 'layer', materialVersion(owner.document, clip.code!).apiVersion, new Set(current.override.addedEffects?.map(effect => effect.key)))
}
/** 三组属性整体替换各自的覆盖，未写的组保留；记录与参数共用一次历史提交。 */
export function writeVideoEditCodeElementGroups(target: VideoEditCodeElementTarget, groups: VideoEditCodeElementGroups, actor: CodeEditActor, gesture?: VideoEditGesture): void {
  const current = readVideoEditCodeElementEdit(target)
  // 改几何与属性要知道是不是调整层：源码静态声明或当前帧观察任一给出即可；只改 opacity/hidden、清空一组即重置都不需要，隐藏的元素也能写回可见。效果只在改动的项上要求观察，见 validateVideoEditElementEffectWrite。
  const kind = videoEditCodeElementKind(current, target.elementId)
  const geometry = (value: CodeElementOverride): unknown[] => codeElementOverrideGeometryKeys(value).map(key => [key, value[key], value.curves?.[key]])
  const requested = groups.transform ? geometry(groups.transform) : []
  const writes = { geometry: requested.length > 0 && !jsonEqual(requested, geometry(current.override)), properties: !!groups.properties && (Object.keys(groups.properties.values).length > 0 || Object.keys(groups.properties.curves ?? {}).length > 0) }
  if (!kind && (writes.geometry || writes.properties)) throw new Error(`元素「${target.elementId}」由数据生成且当前帧没有它的观察结果（此帧不可见或尚未取帧观察）：把播放头移到它可见的帧并取帧观察后再改；已有改动仍保留，写空组可重置。`)
  if (kind === 'adjust' && writes.properties) throw new Error('调整层只能修改效果参数与 opacity。')
  const next = structuredClone(current.override)
  if (groups.transform) {
    for (const key of [...Object.keys(codeElementOverrideValuesSchema.shape), 'curves', 'motionBlur']) delete (next as Record<string, unknown>)[key]
    Object.assign(next, groups.transform)
  }
  if (groups.effects) { delete next.effects; delete next.addedEffects; Object.assign(next, groups.effects) }
  const parsed = codeElementOverrideSchema.parse(next)
  assertCodeElementOverrideAllowed(kind === 'adjust' ? 'adjust' : undefined, parsed)
  validateVideoEditElementEffectWrite(target, parsed)
  const propertyKeys = new Set(current.element?.author.parameterKeys ?? current.program.parameters.filter(param => param.layer === target.elementId).map(param => param.key))
  if (groups.properties) for (const key of new Set([...Object.keys(groups.properties.values), ...Object.keys(groups.properties.curves ?? {})])) if (!propertyKeys.has(key)) throw new Error(`元素没有绑定参数 ${key}；可用参数：${[...propertyKeys].join('、') || '无'}。`)
  editVideoEditCodeElementClip(actor, target, clip => {
    if (Object.keys(parsed).length) { clip.elementOverrides ??= {}; Object.defineProperty(clip.elementOverrides, target.elementId, { value: parsed, writable: true, enumerable: true, configurable: true }) }
    else if (clip.elementOverrides) delete clip.elementOverrides[target.elementId]
    if (groups.properties) {
      for (const key of propertyKeys) { delete clip.code!.parameters[key]; if (clip.code!.curves) delete clip.code!.curves[key] }
      Object.assign(clip.code!.parameters, groups.properties.values)
      clip.code!.curves = { ...clip.code!.curves, ...groups.properties.curves }
      if (!Object.keys(clip.code!.curves).length) delete clip.code!.curves
      prepareCodeMaterialParameters(current.program, clip.code!)
    }
  }, gesture, current.renamedAddedKeys)
}
/** 落盘换过 key 的追加效果时，原 key 下的修改记录跟着改名，不算这次的改动。 */
function withRenamedAddedEffects(clip: ReturnType<typeof resolveVideoEditCodeElementClip>['clip'], elementId: string, renamed: readonly [string, string][]): ReturnType<typeof resolveVideoEditCodeElementClip>['clip'] {
  const base = structuredClone(clip), names = new Map(renamed)
  const override = readCodeElementOverride(base.elementOverrides, elementId)
  if (override?.addedEffects) override.addedEffects = override.addedEffects.map(effect => names.has(effect.key) ? { ...effect, key: names.get(effect.key)! } : effect)
  for (const [from, to] of renamed) {
    const key = codeEditKey.added(elementId, from)
    if (base.edits && Object.hasOwn(base.edits, key)) { base.edits[codeEditKey.added(elementId, to)] = base.edits[key]; delete base.edits[key] }
  }
  return base
}
/** 片段整体写入元素覆盖时，按读回换过的 key 写回的追加项，原 key 下的修改记录跟着改名。 */
export function videoEditClipEditsBase(target: Omit<VideoEditCodeElementTarget, 'elementId'>, before: ReturnType<typeof resolveVideoEditCodeElementClip>['clip'], after: ReturnType<typeof resolveVideoEditCodeElementClip>['clip']): ReturnType<typeof resolveVideoEditCodeElementClip>['clip'] {
  let base = before
  for (const [elementId, value] of Object.entries(before.elementOverrides ?? {})) {
    if (!value.addedEffects?.length) continue
    const keys = new Set(readCodeElementOverride(after.elementOverrides, elementId)?.addedEffects?.map(effect => effect.key))
    const renamed = readVideoEditCodeElementEdit({ ...target, elementId }).renamedAddedKeys.filter(([from, to]) => keys.has(to) && !keys.has(from))
    if (renamed.length) base = withRenamedAddedEffects(base, elementId, renamed)
  }
  return base
}
/** 元素覆盖与修改记录在同一份片段草稿里提交，一次一步历史；手势内合成一步。 */
export function editVideoEditCodeElementClip(actor: CodeEditActor, target: VideoEditCodeElementTarget, change: (clip: ReturnType<typeof resolveVideoEditCodeElementClip>['clip']) => void, gesture?: VideoEditGesture, renamedAddedKeys: readonly [string, string][] = []): void {
  if (gesture && gesture.projectId !== target.projectId) throw new Error('元素调整不属于此剪辑。')
  const update = (document: VideoEditDocument): VideoEditDocument => {
    const { sequence, clip } = resolveVideoEditCodeElementClip(target, document)
    const next = structuredClone(clip)
    change(next)
    recordVideoEditCodeEdits(renamedAddedKeys.length ? withRenamedAddedEffects(clip, target.elementId, renamedAddedKeys) : clip, next, actor)
    if (!Object.keys(next.elementOverrides ?? {}).length) delete next.elementOverrides
    return { ...document, sequences: document.sequences.map(value => value === sequence ? { ...sequence, clips: sequence.clips.map(value => value === clip ? next : value) } : value) }
  }
  if (gesture) updateVideoEditGesture(gesture, update)
  else editVideoProject(target.projectId, update)
}
