import { createLogger } from '@/core/logging'
import { videoEditDocumentSchema, type VideoEditSequence } from '@/core/videoEdit/document'
import { applyVideoEditTimelineEdit, applyVideoEditTimelineEditResult, copyVideoEditClips, type VideoEditClipboard, type VideoEditTimelineEdit } from '@/core/videoEdit/timelineEdits'
import { expandVideoEditSelection, videoEditPickRelations, type VideoEditRelations } from '@/core/videoEdit/timelineSelection'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { inspectVideoEditMedia } from './videoEditMedia'
import { editVideoProject, requireVideoEditInstance, setVideoEditTimelineView, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.timeline')
const clipboards = new WeakMap<VideoEditInstance, VideoEditClipboard>()
/** `linked: false` copies exactly the given clips (the timeline selection is already resolved). */
export function copyVideoEditTimeline(projectId: string, sequenceId: string, clipIds?: string[], linked: VideoEditRelations = true): void {
  const owner = requireVideoEditInstance(projectId)
  clipboards.set(owner, copyVideoEditClips(owner.document, sequenceId, clipIds ?? owner.selectedClipIds, clipIds ? linked : false))
}
export function readVideoEditClipboard(projectId: string): VideoEditClipboard | undefined {
  const value = clipboards.get(requireVideoEditInstance(projectId))
  return value && structuredClone(value)
}
export function executeVideoEditTimelineEdit(projectId: string, sequenceId: string, edit: VideoEditTimelineEdit): VideoEditSequence {
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document
  const result = applyVideoEditTimelineEditResult(baseline, sequenceId, edit, readVideoEditCodeMetadata(owner, baseline)); const sequence = result.sequence
  logger.debug('提交时间线剪辑', { event: 'video_edit.timeline.edit.start', context: { projectId, sequenceId, operation: edit.kind } })
  try {
    editVideoProject(projectId, document => ({ ...document, sequences: document.sequences.map(value => value.id === sequenceId ? sequence : value) }))
    if (owner.activeSequenceId === sequenceId && result.selectedClipIds) setVideoEditTimelineView(projectId, { selectedClipIds: result.selectedClipIds })
    else if (owner.activeSequenceId === sequenceId && edit.kind === 'separate_audio') {
      const original = new Set(baseline.sequences.find(value => value.id === sequenceId)!.clips.map(clip => clip.id))
      setVideoEditTimelineView(projectId, { selectedClipIds: expandVideoEditSelection(sequence, sequence.clips.filter(clip => !original.has(clip.id)).map(clip => clip.id), videoEditPickRelations(owner.linkedSelection !== false)) })
    }
    logger.debug('时间线剪辑已提交', { event: 'video_edit.timeline.edit.completed', context: { projectId, sequenceId, operation: edit.kind } })
    return sequence
  } catch (error) { logger.debug('时间线剪辑未提交', { event: 'video_edit.timeline.edit.failed', error, context: { projectId, sequenceId, operation: edit.kind } }); throw error }
}
export async function separateVideoEditAudio(projectId: string, sequenceId: string, clipIds: string[], audioTrack: number, signal?: AbortSignal, linked: VideoEditRelations = true): Promise<void> {
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document
  const sequence = baseline.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('目标序列不存在。')
  const expanded = expandVideoEditSelection(sequence, clipIds, linked)
  const mediaIds = new Set(sequence.clips.filter(clip => expanded.includes(clip.id)).map(clip => baseline.items.find(item => item.id === clip.itemId)?.mediaId))
  const updates = new Map<string, boolean>()
  for (const id of mediaIds) {
    const media = baseline.media.find(media => media.id === id)
    if (!media || media.kind !== 'video') throw new Error('请选择原视频片段。')
    if (media.hasAudio === undefined) updates.set(media.id, (await inspectVideoEditMedia(media.path, signal)).hasAudio === true)
  }
  signal?.throwIfAborted()
  if (requireVideoEditInstance(projectId) !== owner || owner.document !== baseline) throw new Error('音轨检查期间原剪辑已改变，请重新选择。')
  const candidate = { ...baseline, media: baseline.media.map(media => updates.has(media.id) ? { ...media, hasAudio: updates.get(media.id)! } : media) }
  const next = applyVideoEditTimelineEdit(candidate, sequenceId, { kind: 'separate_audio', clipIds, linked, audioTrack })
  editVideoProject(projectId, () => ({ ...candidate, sequences: candidate.sequences.map(value => value.id === sequenceId ? next : value) }))
  // The new sound portions join each picture's link, so the picked clips select as a pair.
  if (owner.activeSequenceId === sequenceId) setVideoEditTimelineView(projectId, { selectedClipIds: expandVideoEditSelection(next, next.clips.filter(clip => clip.linkId && expanded.includes(clip.id)).map(clip => clip.id), videoEditPickRelations(owner.linkedSelection !== false)) })
}

export interface VideoEditTimelineDrag { readonly projectId: string; readonly sequenceId: string; readonly token: string }
interface DragState { owner: VideoEditInstance; baseline: VideoEditInstance['document']; clipIds: string[] }
const drags = new WeakMap<VideoEditTimelineDrag, DragState>()
export function beginVideoEditTimelineDrag(projectId: string, sequenceId: string, clipIds?: string[]): VideoEditTimelineDrag {
  const owner = requireVideoEditInstance(projectId)
  if (owner.activeSequenceId !== sequenceId) throw new Error('请先打开目标序列。')
  const ids = clipIds ?? owner.selectedClipIds
  copyVideoEditClips(owner.document, sequenceId, ids, false)
  const handle = Object.freeze({ projectId, sequenceId, token: crypto.randomUUID() })
  drags.set(handle, { owner, baseline: owner.document, clipIds: [...ids] })
  return handle
}
function requireDrag(handle: VideoEditTimelineDrag): DragState {
  const state = drags.get(handle)
  if (!state || requireVideoEditInstance(handle.projectId) !== state.owner || state.owner.document !== state.baseline || state.owner.activeSequenceId !== handle.sequenceId || JSON.stringify(state.owner.selectedClipIds) !== JSON.stringify(state.clipIds)) throw new Error('原拖动选区或序列已改变，请重新拖动。')
  return state
}
export type VideoEditTimelineAdjustment = Omit<Extract<VideoEditTimelineEdit, { kind: 'adjust' }>, 'kind' | 'clipIds'>
export function previewVideoEditTimelineDrag(handle: VideoEditTimelineDrag, adjustment: VideoEditTimelineAdjustment): VideoEditSequence {
  const state = requireDrag(handle)
  // Drags move exactly the selection; Alt/Linked Selection already decided whether partners belong to it.
  return applyVideoEditTimelineEdit(state.baseline, handle.sequenceId, { ...adjustment, kind: 'adjust', clipIds: state.clipIds, linked: false }, readVideoEditCodeMetadata(state.owner, state.baseline))
}
export function finishVideoEditTimelineDrag(handle: VideoEditTimelineDrag, adjustment?: VideoEditTimelineAdjustment): void {
  if (!adjustment) { drags.delete(handle); return }
  const state = requireDrag(handle)
  const sequence = previewVideoEditTimelineDrag(handle, adjustment)
  // Schema and source bounds are checked once on release, never for every pointer event.
  videoEditDocumentSchema.parse({ ...state.baseline, sequences: state.baseline.sequences.map(value => value.id === handle.sequenceId ? sequence : value) })
  drags.delete(handle)
  executeVideoEditTimelineEdit(handle.projectId, handle.sequenceId, { ...adjustment, kind: 'adjust', clipIds: state.clipIds, linked: false })
}
export function updateVideoEditTrack(projectId: string, sequenceId: string, trackId: string, patch: Partial<Pick<VideoEditSequence['tracks'][number], 'name' | 'locked' | 'enabled' | 'muted' | 'solo' | 'height' | 'syncLocked'>>): void {
  editVideoProject(projectId, document => {
    const sequence = document.sequences.find(value => value.id === sequenceId)
    if (!sequence?.tracks.some(track => track.id === trackId)) throw new Error('目标轨道不存在。')
    return { ...document, sequences: document.sequences.map(value => value.id === sequenceId ? { ...value, tracks: value.tracks.map(track => track.id === trackId ? { ...track, ...patch } : track) } : value) }
  })
}
