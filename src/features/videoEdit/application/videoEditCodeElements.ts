import { videoEditVisibleTracks, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { evaluateVideoEditClip } from '@/core/videoEdit/keyframes'
import { codeMaterialContextForFrame } from '@/core/videoEdit/codeMaterialTiming'
import { evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import { videoEditFadeOpacity } from '@/core/videoEdit/fades'
import { videoEditClipPictureSize, videoEditFrameToClip } from '@/core/videoEdit/clipGeometry'
import { codeElementAuthorPoint, codeElementFramePolygon, codeElementLabel, cycleCodeElement, hitCodeElementIndex, prepareCodeElementIndex, type CodeElementIndex } from '@/core/videoEdit/codeElementSelection'
import type { CodeElementBounds } from '@/core/videoEdit/codeMaterial/geometry'
import type { CodeMaterialContext, CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import type { VideoEditAnnotation, VideoEditAnnotationTarget } from '@/core/videoEdit/annotations'
import { measureCodeText } from '../videoEditGlyphMetrics'
import { readVideoEditCodeProgram } from './videoEditCodeState'
import { getActiveVideoEditSequence, setVideoEditView, type VideoEditInstance } from './videoEditService'
import { DEFAULT_STYLE_TOKENS, resolveVideoEditStyleKit } from '@/core/videoEdit/styleKit'

export interface VideoEditCodeElementFrame { clip: VideoEditClip; index: CodeElementIndex; picture: { width: number; height: number }; source: string }
interface FrameCache { document: object; sequenceId: string; frame: number; fontGeneration?: number; elements: Map<string, VideoEditCodeElementFrame> }
const frames = new WeakMap<VideoEditInstance, FrameCache>()
interface EvaluatedIndex {
  program: CodeMaterialProgram; code: NonNullable<VideoEditClip['code']>; overrides: VideoEditClip['elementOverrides']
  style: CodeMaterialContext['style']; context: string; fontGeneration?: number; index: CodeElementIndex
}
// Only keep the latest visible frame per instance. Placement/effects change presentation,
// not author geometry; time, parameters, overrides, style and fonts invalidate it.
const indices = new WeakMap<VideoEditInstance, Map<string, EvaluatedIndex>>()
const fontGeneration = (): number | undefined => measureCodeText({ text: '', fontFamily: 'sans-serif', fontWeight: 400, fontStyle: 'normal', fontSize: 12, letterSpacing: 0, lineHeight: 1.2, maxWidth: 0, wrap: false, maxLines: 1 }).fontGeneration

export function videoEditCodeElementFrames(instance: VideoEditInstance, sequenceId = instance.activeSequenceId, frame = instance.frame): Map<string, VideoEditCodeElementFrame> {
  const old = frames.get(instance)
  if (old?.document === instance.document && old.sequenceId === sequenceId && old.frame === frame && (!old.elements.size || old.fontGeneration === fontGeneration())) return old.elements
  const sequence = instance.document.sequences.find(sequence => sequence.id === sequenceId)
  if (!sequence) return new Map()
  const visible = videoEditVisibleTracks(sequence); const elements = new Map<string, VideoEditCodeElementFrame>()
  const previous = indices.get(instance); const evaluatedIndices = new Map<string, EvaluatedIndex>()
  let generation: number | undefined; let measuredGeneration = false
  for (const raw of sequence.clips) {
    if (raw.kind !== 'code' || !raw.code || frame < raw.start || frame >= raw.start + raw.duration || !visible.has(raw.track)) continue
    const evaluated = evaluateVideoEditClip(raw, frame); const clip = { ...evaluated, opacity: evaluated.opacity * videoEditFadeOpacity(raw, frame) }; if (clip.opacity <= 0) continue
    const program = readVideoEditCodeProgram(instance, instance.document, raw.code)
    if (program.languageVersion !== 3) continue
    if (!measuredGeneration) { generation = fontGeneration(); measuredGeneration = true }
    const context = codeMaterialContextForFrame(raw, frame, sequence.frameRate, program)
    context.style = resolveVideoEditStyleKit(instance.document, sequence, raw)?.tokens ?? DEFAULT_STYLE_TOKENS
    const sourceTime = videoEditClipSourceTimeAt(raw, frame - raw.start, sequence.frameRate)
    const key = JSON.stringify([context.time, context.localTime, context.sequenceTime, context.frame, context.fps, context.width, context.height, sourceTime.sourceInUs, sourceTime.sourceRemainder.numerator, sourceTime.sourceRemainder.denominator])
    const cached = previous?.get(raw.id)
    let index: CodeElementIndex
    if (cached && cached.program === program && cached.code === raw.code && cached.overrides === raw.elementOverrides && cached.style === context.style && cached.context === key && cached.fontGeneration === generation) index = cached.index
    else {
      const parameters = evaluateCodeMaterialParameters(prepareCodeMaterialParameters(program, raw.code), sourceTime)
      index = prepareCodeElementIndex(program, context, parameters, measureCodeText, { elementOverrides: raw.elementOverrides, sourceTime })
    }
    evaluatedIndices.set(raw.id, { program, code: raw.code, overrides: raw.elementOverrides, style: context.style, context: key, fontGeneration: generation, index })
    elements.set(raw.id, { clip, picture: { width: context.width, height: context.height }, index, source: codeMaterialSource(instance.document, raw.code).source })
  }
  indices.set(instance, evaluatedIndices)
  frames.set(instance, { document: instance.document, sequenceId, frame, fontGeneration: elements.size ? fontGeneration() : undefined, elements }); return elements
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
  return { clipId: hit.clipId, target: { kind: 'element', elementId: hit.element.elementId, ...(span ? { sourceSpan: { start: span.start, end: span.end } } : {}), region: videoEditCodeElementRegion(entry, hit.element, getActiveVideoEditSequence(instance)) } }
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
