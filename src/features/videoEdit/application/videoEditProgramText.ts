import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '@/core/videoEdit/time'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditVisibleTracks } from '@/core/videoEdit/document'
import { videoEditEdgeTracks } from '@/core/videoEdit/tracks'
import { defaultVideoEditTextStyle } from '@/core/videoEdit/text'
import { createLogger } from '@/core/logging'
import { editVideoProject, getActiveVideoEditSequence, setVideoEditTimelineView, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.text')
/** PR title placement: use an empty targeted video lane, otherwise add a video lane; never overwrite footage. */
export function addVideoEditProgramText(instance: VideoEditInstance, point: { x: number; y: number }, boxWidth = 0): string {
  const sequence = getActiveVideoEditSequence(instance); const frame = instance.frame
  const visible = videoEditVisibleTracks(sequence)
  const lane = sequence.tracks.filter(track => track.kind === 'video' && visible.has(track.index) && !track.locked && instance.targetTrackIds.includes(track.id))
    .sort((a, b) => b.index - a.index).find(track => !sequence.clips.some(clip => clip.track === track.index && clip.start <= frame && frame < clip.start + clip.duration))
  const added = lane ? [] : videoEditEdgeTracks(sequence, 'video', 1).map(track => ({ ...track, solo: sequence.tracks.some(value => value.kind === 'video' && value.enabled && value.solo) }))
  const track = lane ?? added[0]
  const nextFrame = Math.min(VIDEO_EDIT_MAX_SEQUENCE_FRAMES, ...sequence.clips.filter(clip => clip.track === track.index && clip.start > frame).map(clip => clip.start))
  const item = { id: crypto.randomUUID(), name: '文字', kind: 'text' as const }
  const candidate = { ...instance.document, items: [...instance.document.items, item], sequences: instance.document.sequences.map(value => value.id === sequence.id ? { ...value, tracks: [...value.tracks, ...added] } : value) }
  const clip = { ...makeVideoEditItemClip(candidate, item.id, sequence.id, { frame, track: track.index, duration: Math.max(1, Math.min(Math.round(sequence.frameRate.numerator / sequence.frameRate.denominator * 3), nextFrame - frame)) }),
    text: '', x: point.x - .5, y: point.y - .5, textStyle: { ...defaultVideoEditTextStyle(sequence.height), align: 'left' as const, verticalAlign: 'top' as const, boxWidth } }
  editVideoProject(instance.document.id, document => ({ ...document, items: [...document.items, item], sequences: document.sequences.map(value => value.id === sequence.id ? { ...value, tracks: [...value.tracks, ...added], clips: [...value.clips, clip] } : value) }))
  setVideoEditTimelineView(instance.document.id, { selectedClipIds: [clip.id] }, clip.id)
  logger.info('节目文字已放置', { event: 'video_edit.program.text.completed', context: { projectId: instance.document.id, sequenceId: sequence.id, paragraph: boxWidth > 0 } })
  return clip.id
}
