import { captureLogPageSchema, type CaptureEvent } from '@/core/captureLog/events'
import type { VideoEditClip, VideoEditDocument, VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditClipMedia } from '@/core/videoEdit/document'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'
import { RECORDING_CURSOR_EFFECT, type RecordingCursorSource } from '@/core/videoEdit/recordingCursor'
import { RECORDING_ZOOM_EFFECT, recordingZoomRegionsIssue, sortRecordingZoomRegions, suggestRecordingZoomRegions, type RecordingZoomRegion } from '@/core/videoEdit/recordingZoom'
import { RECORDING_FRAME_EFFECT } from '@/core/videoEdit/recordingFrame'
import { fetchRecordingCursorPage } from '../engine/videoEditRecordingCursorSource'
import { editVideoSequence, requireVideoEditInstance, type VideoEditGesture } from './videoEditService'
import type { VideoEditCompositeTarget } from './videoEditCompositing'

/**
 * A screen clip with its pointer log is a recording clip. Its three recording effects always lead the chain in
 * this order: the pointer is redrawn first, zoom then enlarges picture and pointer together, and the frame
 * finally shrinks the result onto its background.
 */
export const RECORDING_CLIP_EFFECTS = [RECORDING_CURSOR_EFFECT, RECORDING_ZOOM_EFFECT, RECORDING_FRAME_EFFECT] as const
export type RecordingClipEffect = typeof RECORDING_CLIP_EFFECTS[number]
const NAMES: Record<RecordingClipEffect, string> = { [RECORDING_CURSOR_EFFECT]: '录制光标', [RECORDING_ZOOM_EFFECT]: '自动缩放', [RECORDING_FRAME_EFFECT]: '录屏画框' }

/** Six zoom depths described by what they show, not by a magnification factor. */
export const RECORDING_ZOOM_DEPTH_LABELS = ['轻微', '较小', '适中', '较大', '很大', '特写'] as const
export function sequenceHasRecordingZoom(sequence: { clips: readonly VideoEditClip[] }): boolean {
  return sequence.clips.some(clip => clip.effects?.some(effect => effect.builtin?.id === RECORDING_ZOOM_EFFECT))
}
export function isRecordingClipEffect(effect: VideoEditEffect): boolean { return (RECORDING_CLIP_EFFECTS as readonly string[]).includes(effect.builtin?.id ?? '') }
export function recordingClipSource(document: VideoEditDocument, clip: VideoEditClip): RecordingCursorSource | undefined {
  return clip.kind === 'video' ? videoEditClipMedia(document, clip)?.recordingCursor : undefined
}
export function recordingClipEffect(clip: VideoEditClip, id: RecordingClipEffect): VideoEditEffect | undefined { return clip.effects?.find(effect => effect.builtin?.id === id) }

export function makeRecordingClipEffect(id: RecordingClipEffect, regions?: readonly RecordingZoomRegion[]): VideoEditEffect {
  return { id: crypto.randomUUID(), name: NAMES[id], enabled: true, amount: 1, builtin: { id, params: {}, ...(id === RECORDING_ZOOM_EFFECT ? { regions: sortRecordingZoomRegions(regions ?? []) } : {}) } }
}
/** Recording effects first, in their fixed order; every other effect keeps its place after them. */
export function orderRecordingClipEffects(effects: readonly VideoEditEffect[]): VideoEditEffect[] {
  const recording = RECORDING_CLIP_EFFECTS.flatMap(id => effects.filter(effect => effect.builtin?.id === id))
  return [...recording, ...effects.filter(effect => !isRecordingClipEffect(effect))]
}

function editClip(target: VideoEditCompositeTarget, update: (clip: VideoEditClip) => VideoEditClip, gesture?: VideoEditGesture): void {
  editVideoSequence(target.projectId, target.sequenceId, sequence => {
    if (!sequence.clips.some(clip => clip.id === target.clipId)) throw new Error('原片段已移除。')
    return { ...sequence, clips: sequence.clips.map(clip => clip.id === target.clipId ? update(clip) : clip) }
  }, gesture)
}
/** Turns one recording effect on (with its defaults) or off; one undo step. */
export function setRecordingClipEffect(target: VideoEditCompositeTarget, id: RecordingClipEffect, enabled: boolean, regions?: readonly RecordingZoomRegion[]): void {
  editClip(target, clip => {
    const others = (clip.effects ?? []).filter(effect => effect.builtin?.id !== id)
    return { ...clip, effects: orderRecordingClipEffects(enabled ? [...others, recordingClipEffect(clip, id) ?? makeRecordingClipEffect(id, regions)] : others) }
  })
}
/** Replaces the zoom regions of the clip's zoom effect; drags pass their gesture so the whole drag is one undo step. */
export function setRecordingZoomRegions(target: VideoEditCompositeTarget, regions: readonly RecordingZoomRegion[], gesture?: VideoEditGesture): void {
  const sorted = sortRecordingZoomRegions(regions)
  const issue = recordingZoomRegionsIssue(sorted)
  if (issue) throw new Error(issue)
  editClip(target, clip => {
    const effect = recordingClipEffect(clip, RECORDING_ZOOM_EFFECT)
    if (!effect?.builtin) throw new Error('这个片段没有开启自动缩放。')
    return { ...clip, effects: (clip.effects ?? []).map(value => value === effect ? { ...effect, builtin: { ...effect.builtin!, regions: sorted } } : value) }
  }, gesture)
}

/** All pointer events of a recording, read from its immutable capture pages. */
export async function readRecordingClipEvents(source: RecordingCursorSource, signal: AbortSignal): Promise<CaptureEvent[]> {
  const events: CaptureEvent[] = []
  for (const page of source.pages) {
    const bytes = await fetchRecordingCursorPage(page, signal)
    events.push(...captureLogPageSchema.parse(JSON.parse(new TextDecoder().decode(bytes))).entries)
  }
  return events
}
/** Zoom regions suggested from the clicks; regions the person adjusted by hand are kept. */
export function suggestRecordingClipZoom(media: Pick<VideoEditMedia, 'durationSeconds'>, source: RecordingCursorSource, events: readonly CaptureEvent[], existing: readonly RecordingZoomRegion[] = []): RecordingZoomRegion[] {
  return suggestRecordingZoomRegions(events, { recordingStartUs: source.recordingStartUs, durationUs: Math.round(media.durationSeconds * 1e6), existing: existing.filter(region => region.origin === 'manual') })
}
/** "重新生成": recompute the automatic regions of one recording clip from its clicks. */
export async function regenerateRecordingClipZoom(target: VideoEditCompositeTarget, signal: AbortSignal): Promise<number> {
  const document = requireVideoEditInstance(target.projectId).document
  const clip = document.sequences.find(sequence => sequence.id === target.sequenceId)?.clips.find(clip => clip.id === target.clipId)
  const media = clip && videoEditClipMedia(document, clip)
  const source = media?.recordingCursor
  if (!clip || !media || !source) throw new Error('这个片段没有录制时的鼠标记录，不能自动生成缩放。')
  const regions = suggestRecordingClipZoom(media, source, await readRecordingClipEvents(source, signal), recordingClipEffect(clip, RECORDING_ZOOM_EFFECT)?.builtin?.regions ?? [])
  signal.throwIfAborted()
  if (recordingClipEffect(clip, RECORDING_ZOOM_EFFECT)) setRecordingZoomRegions(target, regions)
  else setRecordingClipEffect(target, RECORDING_ZOOM_EFFECT, true, regions)
  return regions.length
}
