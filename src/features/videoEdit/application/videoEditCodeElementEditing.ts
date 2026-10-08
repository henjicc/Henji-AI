import { codeElementOverrideValuesSchema, evaluateCodeElementOverride, readCodeElementOverride, codeElementOverrideStatus, type CodeElementOverride, type CodeElementOverrideKey, type CodeElementOverrideValues } from '@/core/videoEdit/codeElementOverrides'
import { bakeCodeElementLiterals, codeElementSourceIds, codeElementTextParameter } from '@/core/videoEdit/codeElementBake'
import { compareCodeMaterialTime, type CodeMaterialKeyframe } from '@/core/videoEdit/codeMaterialAnimation'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import { codeElementLabel } from '@/core/videoEdit/codeElementSelection'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { VideoEditSourceTime } from '@/core/videoEdit/time'
import { openAssistant } from '@/features/assistant/store/assistantUiStore'
import { readVideoEditCodeProgram } from './videoEditCodeState'
import { createVideoEditAnnotation, updateVideoEditAnnotation, videoEditAnnotationPrompt } from './videoEditAnnotations'
import { commitVideoEditCodeCandidate, disposeVideoEditCodeCandidate, prepareVideoEditCodeCandidate } from './videoEditCodeCandidates'
import { videoEditCodeElementFrames, videoEditCodeElementRegion } from './videoEditCodeElements'
import { editVideoProject, focusVideoEditPanel, requireVideoEditInstance, updateVideoEditGesture, type VideoEditGesture } from './videoEditService'
import { setVideoEditCodeParameter, type VideoEditCodeTarget } from './videoEditCodeParameters'

export interface VideoEditCodeElementTarget extends VideoEditCodeTarget { elementId: string }
function resolve(target: VideoEditCodeElementTarget, document = requireVideoEditInstance(target.projectId).document) {
  const sequence = document.sequences.find(value => value.id === target.sequenceId)
  const clip = sequence?.clips.find(value => value.id === target.clipId)
  if (!sequence || clip?.kind !== 'code' || !clip.code || clip.code.versionId !== target.versionId || target.effectId) throw new Error('原代码元素或源码版本已改变，请重新选择。')
  return { sequence, clip }
}
export function readVideoEditCodeElementEdit(target: VideoEditCodeElementTarget) {
  const owner = requireVideoEditInstance(target.projectId); const { sequence, clip } = resolve(target)
  const time = videoEditClipSourceTimeAt(clip, Math.max(0, Math.min(clip.duration - 1, owner.frame - clip.start)), sequence.frameRate)
  const entry = videoEditCodeElementFrames(owner, sequence.id, Math.max(clip.start, Math.min(clip.start + clip.duration - 1, owner.frame))).get(clip.id)
  const element = entry?.index.byId.get(target.elementId)
  const program = readVideoEditCodeProgram(owner, owner.document, clip.code!)
  const override = readCodeElementOverride(clip.elementOverrides, target.elementId) ?? {}
  return { owner, sequence, clip, entry, element, program, override, values: evaluateCodeElementOverride(override, time), time, textParameter: element?.command.kind === 'text' ? codeElementTextParameter(program, element.sourceSpan?.start, element.sourceSpan?.file) : undefined }
}
function edit(target: VideoEditCodeElementTarget, change: (clip: ReturnType<typeof resolve>['clip']) => void, gesture?: VideoEditGesture): void {
  if (gesture && gesture.projectId !== target.projectId) throw new Error('元素调整不属于此剪辑。')
  const update = (document: VideoEditDocument): VideoEditDocument => { const { clip } = resolve(target, document); change(clip); if (!Object.keys(clip.elementOverrides ?? {}).length) delete clip.elementOverrides; return document }
  if (gesture) updateVideoEditGesture(gesture, update)
  else editVideoProject(target.projectId, update)
}
function ensureOverride(clip: ReturnType<typeof resolve>['clip'], id: string): CodeElementOverride {
  const values = clip.elementOverrides ??= {}
  const current = readCodeElementOverride(values, id)
  if (current) return current
  const value: CodeElementOverride = {}
  Object.defineProperty(values, id, { value, writable: true, configurable: true, enumerable: true })
  return value
}
function upsert(points: CodeMaterialKeyframe[], time: VideoEditSourceTime, value: CodeMaterialKeyframe['value'], key: CodeElementOverrideKey): CodeMaterialKeyframe[] {
  const previous = points.find(point => compareCodeMaterialTime(point, time) === 0)
  return [...points.filter(point => point !== previous), { ...time, id: previous?.id ?? crypto.randomUUID(), value, interpolation: previous?.interpolation ?? (['text', 'fontFamily', 'hidden'].includes(key) ? 'hold' : 'linear') } as CodeMaterialKeyframe].sort(compareCodeMaterialTime)
}
/** UI and assistant persist one clip property. Existing animation records the current source time, static fields stay static. */
export function updateVideoEditCodeElement(target: VideoEditCodeElementTarget, patch: CodeElementOverrideValues, options: { gesture?: VideoEditGesture; time?: VideoEditSourceTime } = {}): void {
  const parsed = codeElementOverrideValuesSchema.parse(patch)
  const current = readVideoEditCodeElementEdit(target)
  if (!current.element) throw new Error('此帧的元素不存在，请选择可见元素。')
  if (parsed.text !== undefined && current.textParameter) {
    if (Object.keys(parsed).length !== 1) throw new Error('文字内容和样式请分别修改。')
    setVideoEditCodeParameter(target, current.textParameter, parsed.text, { gesture: options.gesture, time: options.time ?? current.time }); return
  }
  edit(target, clip => {
    const value = ensureOverride(clip, target.elementId)
    for (const [key, next] of Object.entries(parsed)) {
      const field = key as CodeElementOverrideKey
      const points = value.curves?.[field]
      if (points?.length) value.curves![field] = upsert(points, options.time ?? current.time, next, field)
      else Object.assign(value, { [key]: next })
    }
  }, options.gesture)
}
export function resetVideoEditCodeElement(target: VideoEditCodeElementTarget): void { edit(target, clip => { if (clip.elementOverrides) delete clip.elementOverrides[target.elementId] }) }
/** Explicitly arm/freeze transform channels. Static typography is never implicitly keyed. */
export function setVideoEditCodeElementAutoKeyframes(target: VideoEditCodeElementTarget, enabled: boolean): void {
  const current = readVideoEditCodeElementEdit(target)
  edit(target, clip => {
    const override = ensureOverride(clip, target.elementId)
    for (const key of ['dx', 'dy', 'scaleX', 'scaleY', 'rotation'] as const) {
      const value = Number(current.values[key] ?? (key.startsWith('scale') ? 1 : 0))
      if (enabled) { if (!override.curves?.[key]) override.curves = { ...override.curves, [key]: upsert([], current.time, value, key) } }
      else { if (override.curves) delete override.curves[key]; Object.assign(override, { [key]: value }) }
    }
    if (!Object.keys(override.curves ?? {}).length) delete override.curves
  })
}
export function toggleVideoEditCodeElementKeyframe(target: VideoEditCodeElementTarget, key: CodeElementOverrideKey): void {
  const current = readVideoEditCodeElementEdit(target)
  const command = current.element?.command
  const fallback = key === 'dx' || key === 'dy' || key === 'rotation' || key === 'letterSpacing' ? 0 : key === 'scale' || key === 'scaleX' || key === 'scaleY' || key === 'opacity' ? 1 : key === 'hidden' ? false : command && key in command ? (command as unknown as Record<string, unknown>)[key] : undefined
  const value = codeElementOverrideValuesSchema.shape[key].parse(current.values[key] ?? fallback)
  if (value === undefined) throw new Error('此元素没有这项可编辑属性。')
  edit(target, clip => {
    const override = ensureOverride(clip, target.elementId)
    if (override.curves?.[key]) { delete override.curves[key]; Object.assign(override, { [key]: value }); if (!Object.keys(override.curves).length) delete override.curves }
    else override.curves = { ...override.curves, [key]: upsert([], current.time, value, key) }
  })
}
export function videoEditCodeElementOverrideSummary(projectId: string, sequenceId: string, clipId: string) {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(value => value.id === sequenceId); const clip = sequence?.clips.find(value => value.id === clipId)
  if (!clip?.code) return []
  const overrides = clip.elementOverrides ?? {}
  if (!Object.keys(overrides).length) return []
  const program = readVideoEditCodeProgram(owner, owner.document, clip.code)
  const index = videoEditCodeElementFrames(owner, sequenceId, Math.max(clip.start, Math.min(clip.start + clip.duration - 1, owner.frame))).get(clip.id)?.index
  const ids = codeElementSourceIds(program, Object.keys(overrides)); for (const id of index?.byId.keys() ?? []) ids.add(id)
  return codeElementOverrideStatus(overrides, ids).map(value => ({ ...value, label: index?.byId.has(value.elementId) ? codeElementLabel(index.byId.get(value.elementId)!) : value.missing ? '元素已不存在' : '元素当前未显示', fields: Object.keys(overrides[value.elementId]) }))
}
export function askAssistantForVideoEditCodeElement(target: VideoEditCodeElementTarget, bake = false): string {
  const current = readVideoEditCodeElementEdit(target)
  if (!current.element || !current.entry) throw new Error('此元素当前不可见，请选择可见元素。')
  const span = current.element.sourceSpan
  const text = bake ? `请把这些覆盖写回源码，保留其它元素和动画。覆盖：${JSON.stringify(current.override)}；sourceSpan：${JSON.stringify(span)}。创建新的源码版本，在同一事务绑定该片段的新版本并只删除已合并覆盖。` : '请修改这里（等待用户说明）。'
  const id = createVideoEditAnnotation(target.projectId, target.sequenceId, { frame: current.owner.frame, clipId: target.clipId, target: { kind: 'element', elementId: target.elementId, ...(span ? { sourceSpan: { file: span.file, start: span.start, end: span.end } } : {}), region: videoEditCodeElementRegion(current.entry, current.element, current.sequence) }, text, status: 'open' })
  const mark = current.owner.document.sequences.find(sequence => sequence.id === target.sequenceId)!.annotations.find(mark => mark.id === id)!
  openAssistant(bake ? '请把这个元素的覆盖写回源码：' : '请修改这里：', { context: videoEditAnnotationPrompt(target.projectId, [mark], text), onTextSubmitted: submitted => updateVideoEditAnnotation(target.projectId, id, current => ({ ...current, text: bake ? `${text}\n用户说明：${submitted}` : submitted })) })
  return id
}
export async function bakeVideoEditCodeElement(target: VideoEditCodeElementTarget, signal?: AbortSignal): Promise<'baked' | 'assistant'> {
  const current = readVideoEditCodeElementEdit(target)
  if (!current.element || !current.entry) throw new Error('此元素当前不可见。')
  const count = current.entry.index.bounds.filter(bound => bound.sourceSpan?.start === current.element!.sourceSpan?.start && bound.sourceSpan?.file === current.element!.sourceSpan?.file).length
  const result = bakeCodeElementLiterals(current.entry.files.files[current.element.sourceSpan?.file ?? current.entry.files.entry], current.element, current.override, count)
  // Offset-based identities of later calls change when a literal's length changes.
  // Let the assistant rebuild identities rather than silently invalidate other edits.
  const otherOffsetIds = Object.keys(current.clip.elementOverrides ?? {}).some(id => id !== target.elementId && id.startsWith('call:'))
  if (!result.merged || otherOffsetIds) { askAssistantForVideoEditCodeElement(target, true); return 'assistant' }
  const candidate = await prepareVideoEditCodeCandidate(target, { ...current.entry.files, files: { ...current.entry.files.files, [current.element.sourceSpan?.file ?? current.entry.files.entry]: result.source } }, 'single', signal, { clearElementOverrides: [target.elementId] })
  try { if (candidate.impacts.length) throw new Error('源码写回改变了参数，请在源码编辑器中检查。'); commitVideoEditCodeCandidate(candidate); return 'baked' }
  finally { disposeVideoEditCodeCandidate(candidate) }
}
const sourceOpeners = new Map<string, () => void>()
let pendingSource: string | undefined
const sourceOpenerKey = (target: VideoEditCodeTarget): string => JSON.stringify([target.projectId, target.sequenceId, target.clipId, target.versionId, target.effectId])
export function videoEditCodeElementHostSummary(projectId: string) {
  const owner = requireVideoEditInstance(projectId)
  const sequence = owner.document.sequences.find(value => value.id === owner.activeSequenceId)
  const clips = sequence?.clips.filter(clip => owner.selectedClipIds.includes(clip.id) && clip.code && clip.elementOverrides) ?? []
  const count = clips.reduce((sum, clip) => sum + Object.keys(clip.elementOverrides!).length, 0)
  const items: Array<{ clipRef: string; elementId: string; fields: string[]; missing: boolean }> = []
  for (const clip of clips) {
    if (items.length >= 12) break // Context preview budget only; full overrides remain available through the clip entity.
    const status = new Map(videoEditCodeElementOverrideSummary(projectId, sequence!.id, clip.id).map(value => [value.elementId, value.missing]))
    for (const [elementId, value] of Object.entries(clip.elementOverrides!)) { if (items.length >= 12) break; items.push({ clipRef: `video_edit.clip:${projectId}:${clip.id}`, elementId, fields: Object.keys(value), missing: status.get(elementId) === true }) }
  }
  return { count, items }
}
export function registerVideoEditCodeSourceOpener(target: VideoEditCodeTarget, open: () => void): () => void { const key = sourceOpenerKey(target); sourceOpeners.set(key, open); if (pendingSource === key) { pendingSource = undefined; open() } return () => { if (sourceOpeners.get(key) === open) sourceOpeners.delete(key) } }
export function showVideoEditCodeElementSource(target: VideoEditCodeElementTarget): void { resolve(target); const key = sourceOpenerKey(target); focusVideoEditPanel(target.projectId, 'effects'); const open = sourceOpeners.get(key); if (open) open(); else pendingSource = key }
