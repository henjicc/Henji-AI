import { z } from 'zod'
import { videoEditFps } from '@/core/videoEdit/time'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { readVideoEditSource } from './videoEditSource'
import { requireVideoEditInstance, setVideoEditTimelineView } from './videoEditService'
import { executeVideoEditTimelineEdit } from './videoEditTimeline'

export const VIDEO_EDIT_SOURCE_DRAG_MIME = 'application/x-henji-video-edit-source-range'
export const videoEditSourceRangeSchema = z.object({ kind: z.literal('source_range'), projectId: z.string().min(1), itemId: z.string().min(1), sourceIdentity: z.string().min(1).max(33000), inUs: z.number().int().nonnegative(), outUs: z.number().int().positive(), component: z.enum(['video', 'audio', 'linked']) }).strict()
export type VideoEditSourceRange = z.infer<typeof videoEditSourceRangeSchema>
function identity(media: { id: string; path: string; sourceRevision?: string }): string { return JSON.stringify([media.id, media.path, media.sourceRevision ?? '']) }
export function captureVideoEditSourceRange(projectId: string, component: VideoEditSourceRange['component']): VideoEditSourceRange {
  const owner = requireVideoEditInstance(projectId); const source = readVideoEditSource(projectId)
  const item = owner.document.items.find(item => item.id === source.itemId); const media = owner.document.media.find(media => media.id === item?.mediaId)
  if (source.status !== 'ready' || !item || !media || media.kind === 'image') throw new Error('请先打开可用的音视频源素材。')
  if (component === 'video' && media.kind !== 'video' || component === 'linked' && (media.kind !== 'video' || media.hasAudio !== true) || component === 'audio' && media.kind === 'video' && media.hasAudio !== true) throw new Error('此源素材没有已确认的对应音画分量。')
  return videoEditSourceRangeSchema.parse({ kind: 'source_range', projectId, itemId: item.id, sourceIdentity: identity(media), inUs: source.inUs ?? 0, outUs: source.outUs ?? Math.round(media.durationSeconds * 1e6), component })
}
export function writeVideoEditSourceDrag(transfer: DataTransfer, projectId: string, component: VideoEditSourceRange['component']): void { transfer.setData(VIDEO_EDIT_SOURCE_DRAG_MIME, JSON.stringify(captureVideoEditSourceRange(projectId, component))) }
export function placeVideoEditSourceRange(projectId: string, input: VideoEditSourceRange, sequenceId: string, placement: { frame: number; track?: number }): string[] {
  input = videoEditSourceRangeSchema.parse(input)
  const owner = requireVideoEditInstance(projectId)
  if (input.projectId !== projectId) throw new Error('源范围属于另一工程，请先引用原素材。')
  const sequence = owner.document.sequences.find(sequence => sequence.id === sequenceId)
  const item = owner.document.items.find(item => item.id === input.itemId); const media = owner.document.media.find(media => media.id === item?.mediaId)
  if (!sequence || !media || identity(media) !== input.sourceIdentity) throw new Error('原序列或源素材已改变，请重新拖入。')
  const trackFor = (kind: 'video' | 'audio', primary: boolean): number => {
    if (primary && placement.track !== undefined) return placement.track
    const track = sequence.tracks.find(track => track.kind === kind && owner.targetTrackIds.includes(track.id) && !track.locked) ?? sequence.tracks.find(track => track.kind === kind && !track.locked && track.enabled)
    if (!track) throw new Error('请先创建未锁定的对应轨道。')
    return track.index
  }
  const components = input.component === 'linked' ? ['video', 'audio'] as const : [input.component]
  const linkId = input.component === 'linked' ? crypto.randomUUID() : undefined
  const clips = components.map((component, index) => ({ ...makeVideoEditItemClip(owner.document, input.itemId, sequenceId, { frame: 0, track: trackFor(component, index === 0), sourceInUs: input.inUs, sourceOutUs: input.outUs, ...(media.kind === 'video' ? { sourceComponent: component } : {}) }), ...(linkId ? { linkId } : {}) }))
  if (Math.floor((input.outUs - input.inUs) / 1e6 * videoEditFps(sequence.frameRate) + 1e-6) < 1) throw new Error('源选区短于一个序列帧。')
  // The same paste algorithm owns overlap, locks, boundaries, selection and history.
  const result = executeVideoEditTimelineEdit(projectId, sequenceId, { kind: 'place', frame: placement.frame, mode: 'paste', clipboard: { projectId, frameRate: sequence.frameRate, clips, annotations: [], tracks: sequence.tracks.map(track => ({ index: track.index, kind: track.kind })) } })
  const prior = new Set(sequence.clips.map(clip => clip.id)); const ids = result.clips.filter(clip => !prior.has(clip.id)).map(clip => clip.id)
  if (owner.activeSequenceId === sequenceId) setVideoEditTimelineView(projectId, { selectedClipIds: ids })
  return ids
}
