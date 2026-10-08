import { compareCodeMaterialTime, evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { CodeMaterialKeyframe } from '@/core/videoEdit/codeMaterialAnimation'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { validateCodeMaterialParameterValue } from '@/core/videoEdit/codeMaterial/parameters'
import { codeParameterSupportsInterpolation } from '@/core/videoEdit/codeMaterial/parameterInterpolation'
import { videoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditGraphicObjectMetadata } from '@/core/videoEdit/graphics'
import { videoEditTransitionsAt } from '@/core/videoEdit/transitions'
import type { VideoEditSourceTime } from '@/core/videoEdit/time'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import { editVideoProject, requireVideoEditInstance, updateVideoEditGesture } from './videoEditService'
import type { VideoEditGesture } from './videoEditService'
import { readVideoEditCodeMetadata } from './videoEditCodeState'

interface VideoEditParameterOwner { projectId: string; sequenceId: string; clipId: string }
export interface VideoEditCodeTarget extends VideoEditParameterOwner { versionId: string; effectId?: string }
export interface VideoEditGraphicTarget extends VideoEditParameterOwner { objectId: string }
export type VideoEditParameterTarget = VideoEditCodeTarget | VideoEditGraphicTarget
function resolve(document: VideoEditDocument, target: VideoEditParameterTarget) {
  const sequence = document.sequences.find(sequence => sequence.id === target.sequenceId)
  const clip = sequence?.clips.find(clip => clip.id === target.clipId)
  if ('objectId' in target) {
    const object = clip?.graphic?.objects.find(object => object.id === target.objectId)
    if (!sequence || !clip?.graphic || clip.kind !== 'graphic' || !object) throw new Error('原图形对象已改变，请重新选择。')
    return { sequence, clip, binding: object, code: undefined, metadata: videoEditGraphicObjectMetadata(clip.graphic, object) }
  }
  const code = target.effectId ? clip?.effects?.find(effect => effect.id === target.effectId)?.code : clip?.kind === 'code' ? clip.code : undefined
  if (!sequence || !clip || !code || code.versionId !== target.versionId) throw new Error('原代码片段或源码版本已改变，请重新选择。')
  return { sequence, clip, binding: code, code, metadata: undefined }
}
function currentTime(projectId: string, sequenceId: string, clipId: string) {
  const owner = requireVideoEditInstance(projectId)
  const composition = videoEditComposition(owner.document, sequenceId)
  const clip = composition.clips.find(clip => clip.id === clipId)
  if (!clip) throw new Error('原片段已移除。')
  const requested = owner.activeSequenceId === sequenceId ? owner.frame : owner.sequenceViews.get(sequenceId)?.frame ?? clip.start
  const handles = videoEditTransitionsAt(composition, requested).some(window => window.left.id === clipId || window.right.id === clipId)
  const frame = handles ? requested : Math.max(clip.start, Math.min(clip.start + clip.duration - 1, requested))
  return { frame, sourceTime: videoEditClipSourceTimeAt(clip, frame - clip.start, composition.frameRate, handles) }
}
export function readVideoEditCodeEditor(projectId: string, sequenceId: string, clipId: string, effectId?: string) {
  const owner = requireVideoEditInstance(projectId)
  const sequence = owner.document.sequences.find(sequence => sequence.id === sequenceId)
  const clip = sequence?.clips.find(clip => clip.id === clipId)
  const effect = effectId ? clip?.effects?.find(effect => effect.id === effectId) : undefined
  const code = effectId ? effect?.code : clip?.kind === 'code' ? clip.code : undefined
  if (!sequence || !clip || !code) throw new Error('请选择代码片段或代码效果。')
  const target: VideoEditCodeTarget = { projectId, sequenceId, clipId, versionId: code.versionId, ...(effectId ? { effectId } : {}) }
  const metadata = readVideoEditCodeMetadata(owner, owner.document)(code)
  const { frame, sourceTime } = currentTime(projectId, sequenceId, clipId)
  const prepared = prepareCodeMaterialParameters(metadata, code)
  return { target, name: effect?.name ?? clip.name, metadata: structuredClone(metadata), code: structuredClone(code), files: codeMaterialSource(owner.document, code).contents, frame, sourceTime, parameters: evaluateCodeMaterialParameters(prepared, sourceTime), curves: Object.fromEntries([...prepared.curves].map(([key, curve]) => [key, structuredClone(curve.points)])) }
}
export function readVideoEditGraphicEditor(projectId: string, sequenceId: string, clipId: string, objectId: string) {
  const target: VideoEditGraphicTarget = { projectId, sequenceId, clipId, objectId }
  const value = resolve(requireVideoEditInstance(projectId).document, target)
  if (!value.metadata) throw new Error('请选择图形对象。')
  const { frame, sourceTime } = currentTime(projectId, sequenceId, clipId)
  const prepared = prepareCodeMaterialParameters(value.metadata, value.binding)
  return { target, name: value.metadata.name, metadata: value.metadata, frame, sourceTime, object: structuredClone(value.binding), parameters: evaluateCodeMaterialParameters(prepared, sourceTime), curves: Object.fromEntries([...prepared.curves].map(([key, curve]) => [key, structuredClone(curve.points)])) }
}
function edit(target: VideoEditParameterTarget, change: (document: VideoEditDocument, value: ReturnType<typeof resolve>) => void, gesture?: VideoEditGesture): void {
  if (gesture && gesture.projectId !== target.projectId) throw new Error('参数调整不属于此剪辑。')
  const update = (document: VideoEditDocument): VideoEditDocument => { change(document, resolve(document, target)); return document }
  if (gesture) updateVideoEditGesture(gesture, update)
  else editVideoProject(target.projectId, update)
}
function declaration(target: VideoEditParameterTarget, key: string) {
  const owner = requireVideoEditInstance(target.projectId); const resolved = resolve(owner.document, target)
  const metadata = resolved.metadata ?? readVideoEditCodeMetadata(owner, owner.document)(resolved.code!)
  const parameter = metadata.parameters.find(parameter => parameter.key === key)
  if (!parameter) throw new Error('源码没有声明此参数。')
  return { metadata, parameter }
}
function upsert(points: CodeMaterialKeyframe[], time: VideoEditSourceTime, value: CodeMaterialKeyframe['value'], discrete: boolean): CodeMaterialKeyframe[] {
  const current = points.find(point => compareCodeMaterialTime(point, time) === 0)
  const point: CodeMaterialKeyframe = { ...time, id: current?.id ?? crypto.randomUUID(), value, interpolation: current?.interpolation ?? (discrete ? 'hold' : 'linear') }
  return [...points.filter(point => point !== current), point].sort(compareCodeMaterialTime)
}
export function setVideoEditCodeParameter(target: VideoEditParameterTarget, key: string, raw: unknown, options: { gesture?: VideoEditGesture; time?: VideoEditSourceTime } = {}): void {
  const { parameter } = declaration(target, key); const value = validateCodeMaterialParameterValue(parameter, raw)
  edit(target, (_document, { binding: code }) => {
    if (options.time && code.curves?.[key]?.length) {
      if (parameter.type === 'image') throw new Error('图片参数不支持关键帧。')
      code.curves[key] = upsert(code.curves[key], options.time, value as CodeMaterialKeyframe['value'], !codeParameterSupportsInterpolation(parameter))
    } else code.parameters[key] = value
  }, options.gesture)
}
export function resetVideoEditCodeParameter(target: VideoEditParameterTarget, key: string): void {
  const { parameter } = declaration(target, key)
  edit(target, (_document, { binding: code }) => { code.parameters[key] = structuredClone(parameter.default); if (code.curves) { delete code.curves[key]; if (!Object.keys(code.curves).length) delete code.curves } })
}
export function addVideoEditCodeKeyframe(target: VideoEditParameterTarget, key: string, time: VideoEditSourceTime): void {
  const { metadata, parameter } = declaration(target, key)
  if (parameter.type === 'image' || !parameter.animatable) throw new Error('此参数不支持关键帧。')
  edit(target, (_document, { binding: code }) => {
    const value = evaluateCodeMaterialParameters(prepareCodeMaterialParameters(metadata, code), time)[key] as CodeMaterialKeyframe['value']
    code.curves = { ...(code.curves ?? {}), [key]: upsert(code.curves?.[key] ?? [], time, value, !codeParameterSupportsInterpolation(parameter)) }
  })
}
export function updateVideoEditCodeKeyframe(target: VideoEditParameterTarget, key: string, id: string, changes: Partial<Pick<CodeMaterialKeyframe, 'sourceInUs' | 'sourceRemainder' | 'value' | 'interpolation'>>, gesture?: VideoEditGesture): void {
  declaration(target, key)
  edit(target, (_document, { binding: code }) => {
    const points = code.curves?.[key]
    if (!points?.some(point => point.id === id)) throw new Error('原关键帧已移除。')
    code.curves![key] = points.map(point => point.id === id ? { ...point, ...changes } : point).sort(compareCodeMaterialTime)
  }, gesture)
}
export function deleteVideoEditCodeKeyframe(target: VideoEditParameterTarget, key: string, id: string): void {
  edit(target, (_document, { binding: code }) => {
    const points = code.curves?.[key]
    if (!points?.some(point => point.id === id)) throw new Error('原关键帧已移除。')
    const remaining = points.filter(point => point.id !== id)
    if (remaining.length) code.curves![key] = remaining
    else { delete code.curves![key]; if (!Object.keys(code.curves!).length) delete code.curves }
  })
}
export type VideoEditCodeEditorState = ReturnType<typeof readVideoEditCodeEditor>
export type VideoEditGraphicEditorState = ReturnType<typeof readVideoEditGraphicEditor>
export type VideoEditParameterEditorState = VideoEditCodeEditorState | VideoEditGraphicEditorState
