import { applyAuthorElementEffectOverride, authorEffectEnvironmentForClip } from '@/core/videoEdit/authorEffects'
import { codeElementEdits } from '@/core/videoEdit/codeEdits'
import { codeMaterialVersion } from '@/core/videoEdit/codeMaterialDocument'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { videoEditPictureFilter, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { evaluateVideoEditClip } from '@/core/videoEdit/keyframes'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { videoEditClipFadeOpacity } from '@/core/videoEdit/fades'
import { videoEditClipPictureSize, videoEditFrameToClip } from '@/core/videoEdit/clipGeometry'
import { codeElementAuthorPoint, codeElementFramePolygon, codeElementLabel, cycleCodeElement, hitCodeElementIndex, prepareAuthorElementIndex, type CodeElementIndex } from '@/core/videoEdit/codeElementSelection'
import type { CodeElementBounds } from '@/core/videoEdit/codeMaterial/geometry'
import type { AuthorElementObservation, CodeAuthorFrameObservation } from '@/core/videoEdit/codeAuthorProgram'
import type { VideoEditSourceTime } from '@/core/videoEdit/time'
import { authorOverrideMatrix } from '@/core/videoEdit/codeAuthorGeometry'
import { codePoint } from '@/core/videoEdit/codeMaterial/geometry'
import { evaluateCodeElementOverride, readCodeElementOverride } from '@/core/videoEdit/codeElementOverrides'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import type { VideoEditAnnotation, VideoEditAnnotationTarget } from '@/core/videoEdit/annotations'
import { getActiveVideoEditSequence, publishVideoEdit, setVideoEditView, type VideoEditInstance } from './videoEditService'

export interface VideoEditCodeElementFrame { clip: VideoEditClip; index: CodeElementIndex; picture: { width: number; height: number }; files: CodeMaterialFiles }
interface FrameCache { document: object; sequenceId: string; frame: number; elements: Map<string, VideoEditCodeElementFrame> }
/** 每个剪辑实例按序列与帧保留最近几帧的观察：助手或送检取别的帧时，不冲掉播放头所在帧的选中元素。 */
const frames = new WeakMap<VideoEditInstance, FrameCache[]>()
const FRAME_CACHE_SIZE = 4
const codeSource = (code: VideoEditClip['code']) => code && { ...code, parameters: undefined, curves: undefined }

/** Install only observations from the exact document revision that produced the picture. */
export function installVideoEditCodeElements(instance: VideoEditInstance, observation: CodeAuthorFrameObservation): boolean {
  if (observation.revision !== instance.document.revision) return false
  const sequence = instance.document.sequences.find(value => value.id === observation.sequenceId)
  if (!sequence) return false
  const picture = videoEditPictureFilter(sequence), elements = new Map<string, VideoEditCodeElementFrame>()
  for (const observed of observation.clips) {
    const raw = sequence.clips.find(clip => clip.id === observed.clipId)
    if (!raw?.code || raw.kind !== 'code' || raw.code.versionId !== observed.versionId || !picture.has(raw) || observation.frame < raw.start || observation.frame >= raw.start + raw.duration) continue
    const evaluated = evaluateVideoEditClip(raw, observation.frame)
    const clip = { ...evaluated, opacity: evaluated.opacity * videoEditClipFadeOpacity(sequence, raw, observation.frame) }
    if (clip.opacity <= 0) continue
    elements.set(raw.id, { clip, picture: { width: observed.width, height: observed.height }, index: prepareAuthorElementIndex(observed.elements), files: codeMaterialSource(instance.document, raw.code).contents })
  }
  const kept = (frames.get(instance) ?? []).filter(entry => entry.sequenceId !== observation.sequenceId || entry.frame !== observation.frame)
  frames.set(instance, [{ document: instance.document, sequenceId: observation.sequenceId, frame: observation.frame, elements }, ...kept].slice(0, FRAME_CACHE_SIZE))
  publishVideoEdit()
  return true
}
/**
 * `parameterLag`：只给选中框的显示用。参数刚改、新画面还没上屏时沿用上一帧的观察，选框与正在进行的原地编辑不因渲染间隙消失又重建；
 * 命中、写入与助手读取不开它，参数变了就等新画面，不会点到或写到已经不存在的元素。
 */
export function videoEditCodeElementFrames(instance: VideoEditInstance, sequenceId = instance.activeSequenceId, frame = instance.frame, parameterLag = false): Map<string, VideoEditCodeElementFrame> {
  const cached = frames.get(instance)?.find(entry => entry.sequenceId === sequenceId && entry.frame === frame)
  if (!cached) return new Map()
  if (cached.document === instance.document) return cached.elements
  const sequence = instance.document.sequences.find(value => value.id === sequenceId)
  if (!sequence) return new Map()
  const picture = videoEditPictureFilter(sequence)
  const result = new Map<string, VideoEditCodeElementFrame>()
  // Direct manipulation must remain responsive while the next frame is rendering.
  // Reuse only the exact same source time and (unless parameterLag) parameter state; apply host transforms,
  // never call author code or infer drawing operations on the UI thread.
  const refreshEffects = (author: AuthorElementObservation, clip: VideoEditClip, time: VideoEditSourceTime): AuthorElementObservation => {
    if (!author.effectStates) return author
    const code = author.effectStates.filter(state => !state.added && !state.missing).map(({ key, id, name, codeValues }) => ({ key, id, ...(name === undefined ? {} : { name }), codeValues }))
    let resolved
    // 风格件失效等错误由下一次正式渲染报告；这里只是渲染完成前的即时读回，保留上一帧的观察。
    try { resolved = applyAuthorElementEffectOverride(code, evaluateCodeElementOverride(readCodeElementOverride(clip.elementOverrides, author.id) ?? {}, time), authorEffectEnvironmentForClip(instance.document, clip), frame - clip.start, author.id, author.kind === 'adjust' ? 'frame' : 'layer', codeMaterialVersion(instance.document, clip.code!).apiVersion) } catch { return author }
    // 只替换代码效果与追加效果；pose.blur 由下一次渲染按位姿报告。
    return { ...author, effects: [...resolved.effects, ...(author.effects ?? []).filter(effect => effect.source === 'pose.blur')], effectStates: resolved.states, edits: codeElementEdits(clip.edits, author.id, author.parameterKeys) }
  }
  for (const [id, entry] of cached.elements) {
    const raw = sequence.clips.find(clip => clip.id === id)
    if (!raw || raw.kind !== 'code' || !picture.has(raw) || frame < raw.start || frame >= raw.start + raw.duration || JSON.stringify(parameterLag ? codeSource(raw.code) : raw.code) !== JSON.stringify(parameterLag ? codeSource(entry.clip.code) : entry.clip.code)) continue
    const time = videoEditClipSourceTimeAt(raw, frame - raw.start, sequence.frameRate)
    if (JSON.stringify(time) !== JSON.stringify(videoEditClipSourceTimeAt(entry.clip, frame - entry.clip.start, sequence.frameRate))) continue
    const observations = entry.index.bounds.flatMap(bound => {
      const author = bound.author
      if (author.kind === 'adjust') {
        const override = evaluateCodeElementOverride(readCodeElementOverride(raw.elementOverrides, author.id) ?? {}, time)
        return override.hidden ? [] : [{ ...refreshEffects(author, raw, time), opacity: (author.baseOpacity ?? 1) * (override.opacity ?? 1) }]
      }
      if (!author?.baseMatrix || !author.bounds) return []
      const override = evaluateCodeElementOverride(readCodeElementOverride(raw.elementOverrides, author.id) ?? {}, time)
      if (override.hidden) return []
      const matrix = authorOverrideMatrix(author.baseMatrix, author.bounds, override)
      const [x, y, right, bottom] = author.bounds
      return [{ ...refreshEffects(author, raw, time), matrix, opacity: (author.baseOpacity ?? 1) * (override.opacity ?? 1), corners: [[x, y], [right, y], [right, bottom], [x, bottom]].map(([x, y]) => codePoint(matrix, x, y)) }]
    })
    const evaluated = evaluateVideoEditClip(raw, frame)
    const opacity = evaluated.opacity * videoEditClipFadeOpacity(sequence, raw, frame)
    if (opacity <= 0) continue
    result.set(id, { ...entry, clip: { ...evaluated, opacity }, index: prepareAuthorElementIndex(observations) })
  }
  return result
}
/** Pick only within the top visible picture. A non-code clip occludes code beneath it. */
export function videoEditProgramClipAt(instance: VideoEditInstance, point: { x: number; y: number }): { clip: VideoEditClip; picture: { width: number; height: number }; entry?: VideoEditCodeElementFrame } | undefined {
  const sequence = getActiveVideoEditSequence(instance); const picture = videoEditPictureFilter(sequence)
  const elements = videoEditCodeElementFrames(instance)
  const clips = sequence.clips.filter(clip => clip.kind !== 'audio' && clip.kind !== 'adjustment' && clip.kind !== 'light' && instance.frame >= clip.start && instance.frame < clip.start + clip.duration && picture.has(clip)).sort((a, b) => b.track - a.track)
  for (const raw of clips) {
    const evaluated = evaluateVideoEditClip(raw, instance.frame); const clip = { ...evaluated, opacity: evaluated.opacity * videoEditClipFadeOpacity(sequence, raw, instance.frame) }; if (clip.opacity <= 0) continue
    const entry = elements.get(clip.id)
    const picture = entry?.picture ?? videoEditClipPictureSize({ ...instance.document, ...sequence }, clip)
    const local = videoEditFrameToClip(clip, picture, sequence, point.x, point.y)
    if (local.u < 0 || local.v < 0 || local.u > 1 || local.v > 1) continue
    return { clip, picture, entry }
  }
  return undefined
}
export function hitVideoEditCodeElement(instance: VideoEditInstance, point: { x: number; y: number }, cycle = false): { clipId: string; element: CodeElementBounds } | undefined {
  const target = videoEditProgramClipAt(instance, point)
  if (!target?.entry) return undefined
  const author = codeElementAuthorPoint(target.clip, target.picture, getActiveVideoEditSequence(instance), point)
  const hits = hitCodeElementIndex(target.entry.index, author.x, author.y)
  const element = cycleCodeElement(hits, instance.selectedCodeElement?.clipId === target.clip.id ? instance.selectedCodeElement.elementId : undefined, cycle)
  return element ? { clipId: target.clip.id, element } : undefined
}
export function selectVideoEditCodeElement(instance: VideoEditInstance, clipId: string, elementId: string | null): void {
  const entry = videoEditCodeElementFrames(instance).get(clipId)
  if (elementId !== null && !entry?.index.byId.has(elementId)) throw new Error('此元素在当前帧不可见，请重新选择。')
  if (instance.selection === clipId && instance.selectedCodeElement?.elementId === elementId && instance.selectedCodeElement.versionId === entry?.clip.code?.versionId) return
  setVideoEditView(instance.document.id, { selection: clipId, selectedCodeElement: elementId && entry ? { sequenceId: instance.activeSequenceId, clipId, versionId: entry.clip.code!.versionId, elementId } : null })
}
export function readSelectedVideoEditCodeElement(instance: VideoEditInstance): { entry: VideoEditCodeElementFrame; element: CodeElementBounds; label: string; parameterKeys: string[] } | undefined {
  const selection = instance.selectedCodeElement
  if (!selection || selection.sequenceId !== instance.activeSequenceId || selection.clipId !== instance.selection) return undefined
  const entry = videoEditCodeElementFrames(instance, instance.activeSequenceId, instance.frame, true).get(selection.clipId)
  if (!entry || entry.clip.code?.versionId !== selection.versionId) return undefined
  const element = entry.index.byId.get(selection.elementId)
  return element && element.opacity >= .01 && (element.author.kind === 'adjust' || element.width > 0 && element.height > 0) ? { entry, element, label: codeElementLabel(element), parameterKeys: entry.index.parameters.get(element.elementId) ?? [] } : undefined
}
/** 画面选框只消费空间元素；逻辑选择与助手上下文允许没有画面范围的调整层。 */
export function selectedVideoEditCodeElement(instance: VideoEditInstance): ReturnType<typeof readSelectedVideoEditCodeElement> {
  const selected = readSelectedVideoEditCodeElement(instance)
  return selected?.element.author.kind === 'adjust' ? undefined : selected
}
export function videoEditCodeElementRegion(entry: VideoEditCodeElementFrame, element: CodeElementBounds, sequence: Pick<VideoEditComposition, 'width' | 'height'>): { x: number; y: number; width: number; height: number } | undefined {
  const polygon = codeElementFramePolygon(element, entry.clip, entry.picture, sequence)
  const x = Math.max(0, Math.min(...polygon.map(point => point.x))); const y = Math.max(0, Math.min(...polygon.map(point => point.y)))
  const right = Math.min(1, Math.max(...polygon.map(point => point.x))); const bottom = Math.min(1, Math.max(...polygon.map(point => point.y)))
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined
}
export function codeElementAnnotationTarget(instance: VideoEditInstance, point: { x: number; y: number }): { clipId: string; target: VideoEditAnnotationTarget } | undefined {
  const hit = hitVideoEditCodeElement(instance, point); if (!hit) return undefined
  const entry = videoEditCodeElementFrames(instance).get(hit.clipId)!
  const span = hit.element.sourceSpan
  return { clipId: hit.clipId, target: { kind: 'element', elementId: hit.element.elementId, ...(span ? { sourceSpan: { file: span.file, start: span.start, end: span.end } } : {}), region: videoEditCodeElementRegion(entry, hit.element, getActiveVideoEditSequence(instance)) } }
}
/** Derived display only: following animation must never rewrite the persisted annotation or add undo entries. */
export function resolveVideoEditElementAnnotation(instance: VideoEditInstance, mark: VideoEditAnnotation, sequenceId = instance.activeSequenceId, frame = instance.frame): { mark: VideoEditAnnotation; missing: boolean; label?: string } {
  if (mark.target.kind !== 'element') return { mark, missing: false }
  const entry = videoEditCodeElementFrames(instance, sequenceId, frame).get(mark.clipId ?? '')
  const element = entry?.index.byId.get(mark.target.elementId)
  if (!entry || !element) return { mark: { ...mark, target: { ...mark.target, region: undefined } }, missing: true }
  const sequence = instance.document.sequences.find(sequence => sequence.id === sequenceId)!
  return { mark: { ...mark, target: { ...mark.target, region: videoEditCodeElementRegion(entry, element, sequence) } }, missing: false, label: codeElementLabel(element) }
}
export const VIDEO_EDIT_CODE_ELEMENT = 'video_edit.code_element'
/** 代码元素的稳定引用：剪辑、序列、片段与作者图层 id。 */
export function videoEditCodeElementRef(target: { projectId: string; sequenceId: string; clipId: string; elementId: string }): { kind: typeof VIDEO_EDIT_CODE_ELEMENT; id: string } {
  return { kind: VIDEO_EDIT_CODE_ELEMENT, id: [target.projectId, target.sequenceId, target.clipId, target.elementId].map(encodeURIComponent).join(':') }
}
export function videoEditSelectedCodeElementContext(instance: VideoEditInstance): { clipRef: string; elementRef: ReturnType<typeof videoEditCodeElementRef>; elementId: string; sourceSpan?: CodeElementBounds['sourceSpan']; parameterKeys: string[]; effects?: import('@/core/videoEdit/authorEffects').ResolvedAuthorEffect[] } | null {
  const selected = readSelectedVideoEditCodeElement(instance)
  return selected ? { clipRef: `video_edit.clip:${instance.document.id}:${selected.entry.clip.id}`, elementRef: videoEditCodeElementRef({ projectId: instance.document.id, sequenceId: instance.activeSequenceId, clipId: selected.entry.clip.id, elementId: selected.element.elementId }), elementId: selected.element.elementId, ...(selected.element.sourceSpan ? { sourceSpan: selected.element.sourceSpan } : {}), parameterKeys: selected.parameterKeys, effects: selected.element.author?.effects } : null
}
