import { compareCodeMaterialTime, evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { CodeMaterialKeyframe } from '@/core/videoEdit/codeMaterialAnimation'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { validateCodeMaterialParameterValue } from '@/core/videoEdit/codeMaterial/parameters'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { VideoEditSourceTime } from '@/core/videoEdit/time'
import { offsetVideoEditSource } from '@/core/videoEdit/time'
import { editVideoProject, requireVideoEditInstance, updateVideoEditGesture } from './videoEditService'
import type { VideoEditGesture } from './videoEditService'
import { readVideoEditCodeMetadata } from './videoEditCodeState'

export interface VideoEditCodeTarget { projectId: string; sequenceId: string; clipId: string; versionId: string }
function resolve(document: VideoEditDocument, target: VideoEditCodeTarget) {
  const sequence = document.sequences.find(sequence => sequence.id === target.sequenceId)
  const clip = sequence?.clips.find(clip => clip.id === target.clipId)
  if (!sequence || !clip?.code || clip.kind !== 'code' || clip.code.versionId !== target.versionId) throw new Error('原代码片段或源码版本已改变，请重新选择。')
  return { sequence, clip, code: clip.code }
}
export function readVideoEditCodeEditor(projectId: string, sequenceId: string, clipId: string) {
  const owner = requireVideoEditInstance(projectId)
  const sequence = owner.document.sequences.find(sequence => sequence.id === sequenceId)
  const clip = sequence?.clips.find(clip => clip.id === clipId)
  if (!sequence || !clip?.code || clip.kind !== 'code') throw new Error('请选择代码片段。')
  const target: VideoEditCodeTarget = { projectId, sequenceId, clipId, versionId: clip.code.versionId }
  const metadata = readVideoEditCodeMetadata(owner, owner.document)(clip.code)
  const requestedFrame = owner.activeSequenceId === sequenceId ? owner.frame : owner.sequenceViews.get(sequenceId)?.frame ?? clip.start
  const frame = Math.max(clip.start, Math.min(clip.start + clip.duration - 1, requestedFrame))
  const sourceTime = offsetVideoEditSource(clip, frame - clip.start, sequence.frameRate)
  const prepared = prepareCodeMaterialParameters(metadata, clip.code)
  return { target, name: clip.name, metadata: structuredClone(metadata), code: structuredClone(clip.code), source: codeMaterialSource(owner.document, clip.code).source, frame, sourceTime, parameters: evaluateCodeMaterialParameters(prepared, sourceTime), curves: Object.fromEntries([...prepared.curves].map(([key, curve]) => [key, structuredClone(curve.points)])) }
}
function edit(target: VideoEditCodeTarget, change: (document: VideoEditDocument, value: ReturnType<typeof resolve>) => void, gesture?: VideoEditGesture): void {
  if (gesture && gesture.projectId !== target.projectId) throw new Error('参数调整不属于此工程。')
  const update = (document: VideoEditDocument): VideoEditDocument => { change(document, resolve(document, target)); return document }
  if (gesture) updateVideoEditGesture(gesture, update)
  else editVideoProject(target.projectId, update)
}
function declaration(target: VideoEditCodeTarget, key: string) {
  const owner = requireVideoEditInstance(target.projectId); const { code } = resolve(owner.document, target)
  const metadata = readVideoEditCodeMetadata(owner, owner.document)(code)
  const parameter = metadata.parameters.find(parameter => parameter.key === key)
  if (!parameter) throw new Error('源码没有声明此参数。')
  return { metadata, parameter }
}
function upsert(points: CodeMaterialKeyframe[], time: VideoEditSourceTime, value: CodeMaterialKeyframe['value'], discrete: boolean): CodeMaterialKeyframe[] {
  const current = points.find(point => compareCodeMaterialTime(point, time) === 0)
  const point: CodeMaterialKeyframe = { ...time, id: current?.id ?? crypto.randomUUID(), value, interpolation: current?.interpolation ?? (discrete ? 'hold' : 'linear') }
  return [...points.filter(point => point !== current), point].sort(compareCodeMaterialTime)
}
export function setVideoEditCodeParameter(target: VideoEditCodeTarget, key: string, raw: unknown, options: { gesture?: VideoEditGesture; time?: VideoEditSourceTime } = {}): void {
  const { parameter } = declaration(target, key); const value = validateCodeMaterialParameterValue(parameter, raw)
  edit(target, (_document, { code }) => {
    if (options.time && code.curves?.[key]?.length) {
      if (parameter.type === 'image') throw new Error('图片参数不支持关键帧。')
      code.curves[key] = upsert(code.curves[key], options.time, value as CodeMaterialKeyframe['value'], !['number', 'color'].includes(parameter.type))
    } else code.parameters[key] = value
  }, options.gesture)
}
export function resetVideoEditCodeParameter(target: VideoEditCodeTarget, key: string): void {
  const { parameter } = declaration(target, key)
  edit(target, (_document, { code }) => { code.parameters[key] = structuredClone(parameter.default); if (code.curves) { delete code.curves[key]; if (!Object.keys(code.curves).length) delete code.curves } })
}
export function addVideoEditCodeKeyframe(target: VideoEditCodeTarget, key: string, time: VideoEditSourceTime): void {
  const { metadata, parameter } = declaration(target, key)
  if (parameter.type === 'image' || !parameter.animatable) throw new Error('此参数不支持关键帧。')
  edit(target, (_document, { code }) => {
    const value = evaluateCodeMaterialParameters(prepareCodeMaterialParameters(metadata, code), time)[key] as CodeMaterialKeyframe['value']
    code.curves = { ...(code.curves ?? {}), [key]: upsert(code.curves?.[key] ?? [], time, value, !['number', 'color'].includes(parameter.type)) }
  })
}
export function updateVideoEditCodeKeyframe(target: VideoEditCodeTarget, key: string, id: string, changes: Partial<Pick<CodeMaterialKeyframe, 'sourceInUs' | 'sourceRemainder' | 'value' | 'interpolation'>>, gesture?: VideoEditGesture): void {
  declaration(target, key)
  edit(target, (_document, { code }) => {
    const points = code.curves?.[key]
    if (!points?.some(point => point.id === id)) throw new Error('原关键帧已移除。')
    code.curves![key] = points.map(point => point.id === id ? { ...point, ...changes } : point).sort(compareCodeMaterialTime)
  }, gesture)
}
export function deleteVideoEditCodeKeyframe(target: VideoEditCodeTarget, key: string, id: string): void {
  edit(target, (_document, { code }) => {
    const points = code.curves?.[key]
    if (!points?.some(point => point.id === id)) throw new Error('原关键帧已移除。')
    const remaining = points.filter(point => point.id !== id)
    if (remaining.length) code.curves![key] = remaining
    else { delete code.curves![key]; if (!Object.keys(code.curves!).length) delete code.curves }
  })
}
export type VideoEditCodeEditorState = ReturnType<typeof readVideoEditCodeEditor>
