import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { videoEditVisibleTracks, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { evaluateVideoEditClip } from '@/core/videoEdit/keyframes'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { videoEditFadeOpacity } from '@/core/videoEdit/fades'
import { videoEditClipPictureSize, videoEditFrameToClip } from '@/core/videoEdit/clipGeometry'
import { codeElementAuthorPoint, codeElementFramePolygon, codeElementLabel, cycleCodeElement, hitCodeElementIndex, prepareAuthorElementIndex, type CodeElementIndex } from '@/core/videoEdit/codeElementSelection'
import type { CodeElementBounds } from '@/core/videoEdit/codeMaterial/geometry'
import type { CodeAuthorFrameObservation } from '@/core/videoEdit/codeAuthorProgram'
import { authorOverrideMatrix } from '@/core/videoEdit/codeAuthorGeometry'
import { codePoint } from '@/core/videoEdit/codeMaterial/geometry'
import { evaluateCodeElementOverride, readCodeElementOverride } from '@/core/videoEdit/codeElementOverrides'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import type { VideoEditAnnotation, VideoEditAnnotationTarget } from '@/core/videoEdit/annotations'
import { getActiveVideoEditSequence, publishVideoEdit, setVideoEditView, type VideoEditInstance } from './videoEditService'

export interface VideoEditCodeElementFrame { clip: VideoEditClip; index: CodeElementIndex; picture: { width: number; height: number }; files: CodeMaterialFiles }
interface FrameCache { document: object; sequenceId: string; frame: number; elements: Map<string, VideoEditCodeElementFrame> }
const frames = new WeakMap<VideoEditInstance, FrameCache>()

/** Install only observations from the exact document revision that produced the picture. */
export function installVideoEditCodeElements(instance: VideoEditInstance, observation: CodeAuthorFrameObservation): boolean {
  if (observation.revision !== instance.document.revision) return false
  const sequence = instance.document.sequences.find(value => value.id === observation.sequenceId)
  if (!sequence) return false
  const visible = videoEditVisibleTracks(sequence), elements = new Map<string, VideoEditCodeElementFrame>()
  for (const observed of observation.clips) {
    const raw = sequence.clips.find(clip => clip.id === observed.clipId)
    if (!raw?.code || raw.kind !== 'code' || raw.code.versionId !== observed.versionId || !visible.has(raw.track) || observation.frame < raw.start || observation.frame >= raw.start + raw.duration) continue
    const evaluated = evaluateVideoEditClip(raw, observation.frame)
    const clip = { ...evaluated, opacity: evaluated.opacity * videoEditFadeOpacity(raw, observation.frame) }
    if (clip.opacity <= 0) continue
    elements.set(raw.id, { clip, picture: { width: observed.width, height: observed.height }, index: prepareAuthorElementIndex(observed.elements), files: codeMaterialSource(instance.document, raw.code).contents })
  }
  frames.set(instance, { document: instance.document, sequenceId: observation.sequenceId, frame: observation.frame, elements })
  publishVideoEdit()
  return true
}
export function videoEditCodeElementFrames(instance: VideoEditInstance, sequenceId = instance.activeSequenceId, frame = instance.frame): Map<string, VideoEditCodeElementFrame> {
  const cached = frames.get(instance)
  if (!cached || cached.sequenceId !== sequenceId || cached.frame !== frame) return new Map()
  if (cached.document === instance.document) return cached.elements
  const sequence = instance.document.sequences.find(value => value.id === sequenceId)
  if (!sequence) return new Map()
  const visible = videoEditVisibleTracks(sequence)
  const result = new Map<string, VideoEditCodeElementFrame>()
  // Direct manipulation must remain responsive while the next frame is rendering.
  // Reuse only the exact same source time and parameter state; apply host transforms,
  // never call author code or infer drawing operations on the UI thread.
  for (const [id, entry] of cached.elements) {
    const raw = sequence.clips.find(clip => clip.id === id)
    if (!raw || raw.kind !== 'code' || !visible.has(raw.track) || frame < raw.start || frame >= raw.start + raw.duration || JSON.stringify(raw.code) !== JSON.stringify(entry.clip.code)) continue
    const time = videoEditClipSourceTimeAt(raw, frame - raw.start, sequence.frameRate)
    if (JSON.stringify(time) !== JSON.stringify(videoEditClipSourceTimeAt(entry.clip, frame - entry.clip.start, sequence.frameRate))) continue
    const observations = entry.index.bounds.flatMap(bound => {
      const author = bound.author
      if (!author?.baseMatrix) return []
      const override = evaluateCodeElementOverride(readCodeElementOverride(raw.elementOverrides, author.id) ?? {}, time)
      if (override.hidden) return []
      const matrix = authorOverrideMatrix(author.baseMatrix, author.bounds, override)
      const [x, y, right, bottom] = author.bounds
      return [{ ...author, matrix, opacity: (author.baseOpacity ?? 1) * (override.opacity ?? 1), corners: [[x, y], [right, y], [right, bottom], [x, bottom]].map(([x, y]) => codePoint(matrix, x, y)) }]
    })
    const evaluated = evaluateVideoEditClip(raw, frame)
    const opacity = evaluated.opacity * videoEditFadeOpacity(raw, frame)
    if (opacity <= 0) continue
    result.set(id, { ...entry, clip: { ...evaluated, opacity }, index: prepareAuthorElementIndex(observations) })
  }
  return result
}
/** Pick only within the top visible picture. A non-code clip occludes code beneath it. */
export function videoEditProgramClipAt(instance: VideoEditInstance, point: { x: number; y: number }): { clip: VideoEditClip; picture: { width: number; height: number }; entry?: VideoEditCodeElementFrame } | undefined {
  const sequence = getActiveVideoEditSequence(instance); const visible = videoEditVisibleTracks(sequence)
  const elements = videoEditCodeElementFrames(instance)
  const clips = sequence.clips.filter(clip => clip.kind !== 'audio' && clip.kind !== 'adjustment' && instance.frame >= clip.start && instance.frame < clip.start + clip.duration && visible.has(clip.track)).sort((a, b) => b.track - a.track)
  for (const raw of clips) {
    const evaluated = evaluateVideoEditClip(raw, instance.frame); const clip = { ...evaluated, opacity: evaluated.opacity * videoEditFadeOpacity(raw, instance.frame) }; if (clip.opacity <= 0) continue
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
export function selectedVideoEditCodeElement(instance: VideoEditInstance): { entry: VideoEditCodeElementFrame; element: CodeElementBounds; label: string; parameterKeys: string[] } | undefined {
  const selection = instance.selectedCodeElement
  if (!selection || selection.sequenceId !== instance.activeSequenceId || selection.clipId !== instance.selection) return undefined
  const entry = videoEditCodeElementFrames(instance).get(selection.clipId)
  if (!entry || entry.clip.code?.versionId !== selection.versionId) return undefined
  const element = entry.index.byId.get(selection.elementId)
  return element && element.opacity >= .01 && element.width > 0 && element.height > 0 ? { entry, element, label: codeElementLabel(element), parameterKeys: entry.index.parameters.get(element.elementId) ?? [] } : undefined
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
export function videoEditSelectedCodeElementContext(instance: VideoEditInstance): { clipRef: string; elementId: string; sourceSpan?: CodeElementBounds['sourceSpan']; parameterKeys: string[] } | null {
  const selected = selectedVideoEditCodeElement(instance)
  return selected ? { clipRef: `video_edit.clip:${instance.document.id}:${selected.entry.clip.id}`, elementId: selected.element.elementId, ...(selected.element.sourceSpan ? { sourceSpan: selected.element.sourceSpan } : {}), parameterKeys: selected.parameterKeys } : null
}
