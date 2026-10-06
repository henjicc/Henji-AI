import { videoEditEdgeTracks } from '@/core/videoEdit/tracks'
import { z } from 'zod'
import { videoEditFps } from '@/core/videoEdit/time'
import { placeVideoEditItem } from '@/core/videoEdit/projectItems'
import { resolveVideoEditDropMode, type VideoEditDropMode } from '@/core/videoEdit/dropPlacement'
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
/** `newTrack`: dropped beyond the outer tracks — the range lands on a new track of that kind (PR), in the same edit. */
export function placeVideoEditSourceRange(projectId: string, input: VideoEditSourceRange, sequenceId: string, placement: { frame: number; track?: number; newTrack?: 'video' | 'audio'; mode?: VideoEditDropMode }): string[] {
  input = videoEditSourceRangeSchema.parse(input)
  const owner = requireVideoEditInstance(projectId)
  if (input.projectId !== projectId) throw new Error('源范围属于另一剪辑，请先引用原素材。')
  const sequence = owner.document.sequences.find(sequence => sequence.id === sequenceId)
  const item = owner.document.items.find(item => item.id === input.itemId); const media = owner.document.media.find(media => media.id === item?.mediaId)
  if (!sequence || !media || identity(media) !== input.sourceIdentity) throw new Error('原序列或源素材已改变，请重新拖入。')
  const edge = placement.newTrack ? videoEditEdgeTracks(sequence, placement.newTrack, 1)[0] : undefined
  const trackFor = (kind: 'video' | 'audio'): number | undefined => edge?.kind === kind ? edge.index : (sequence.tracks.find(track => track.kind === kind && owner.targetTrackIds.includes(track.id) && !track.locked) ?? sequence.tracks.find(track => track.kind === kind && !track.locked && track.enabled))?.index
  if (Math.floor((input.outUs - input.inUs) / 1e6 * videoEditFps(sequence.frameRate) + 1e-6) < 1) throw new Error('源选区短于一个序列帧。')
  const primary = input.component === 'audio' || media.kind === 'audio' ? 'audio' : 'video'
  const fallback = trackFor(primary)
  if (placement.track === undefined && fallback === undefined) throw new Error('请先创建未锁定的对应轨道。')
  const document = edge ? { ...owner.document, sequences: owner.document.sequences.map(value => value.id === sequenceId ? { ...value, tracks: [...value.tracks, edge] } : value) } : owner.document
  const videoTrack = primary === 'video' ? placement.track ?? fallback : undefined; const audioTrack = primary === 'audio' ? placement.track ?? fallback : trackFor('audio')
  // Every audio clip of the item's layout comes along, on the following audio tracks (task 2.6).
  const placed = placeVideoEditItem(document, input.itemId, sequenceId, { frame: 0, ...(videoTrack !== undefined ? { videoTrack } : {}), ...(audioTrack !== undefined ? { audioTrack } : {}), sourceInUs: input.inUs, sourceOutUs: input.outUs, components: media.kind === 'video' ? input.component : 'audio' })
  // The same paste algorithm owns overlap, locks, boundaries, selection and history.
  const added = [...(edge && placed.clips.some(clip => clip.track === edge.index) ? [edge] : []), ...placed.addedTracks]
  // 不带落点方式（时间线拖入）按粘贴放置，不覆盖已有内容；节目监视器的拖放区给出方式，换算后走同一放置编辑。
  const resolved = placement.mode ? resolveVideoEditDropMode(sequence, placed.clips, { mode: placement.mode, frame: placement.frame, targetTrackIds: owner.targetTrackIds, tracks: added }) : undefined
  const newTracks = resolved ? [...added, ...resolved.newTracks].filter(track => resolved.clips.some(clip => clip.track === track.index)) : added
  const tracks = [...sequence.tracks, ...newTracks]
  const clips = resolved?.clips ?? placed.clips
  const result = executeVideoEditTimelineEdit(projectId, sequenceId, { kind: 'place', frame: resolved?.frame ?? placement.frame, mode: resolved?.mode ?? 'paste', clipboard: { projectId, frameRate: sequence.frameRate, clips, annotations: [], tracks: tracks.map(track => ({ index: track.index, kind: track.kind })) }, ...(newTracks.length ? { newTracks } : {}), ...(resolved?.mode === 'insert' ? { targetTracks: [...new Set(clips.map(clip => clip.track))] } : {}) })
  const prior = new Set(sequence.clips.map(clip => clip.id)); const ids = result.clips.filter(clip => !prior.has(clip.id)).map(clip => clip.id)
  if (owner.activeSequenceId === sequenceId) setVideoEditTimelineView(projectId, { selectedClipIds: ids })
  return ids
}
