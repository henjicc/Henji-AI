import type { VideoEditSequence } from './document'
import { z } from 'zod'

export type VideoEditTimelineTool = 'select' | 'razor' | 'hand' | 'track'
export const videoEditTimelineViewSchema = z.object({
  selectedClipIds: z.array(z.string().min(1).max(100)).max(500), targetTrackIds: z.array(z.string().min(1).max(100)).max(32),
  tool: z.enum(['select', 'razor', 'hand', 'track']), snapping: z.boolean(), zoom: z.number().finite().min(.1).max(20),
  inFrame: z.number().int().min(0).max(108000).nullable(), outFrame: z.number().int().min(0).max(108000).nullable(),
}).strict().refine(view => view.inFrame === null || view.outFrame === null || view.outFrame > view.inFrame, '出点必须晚于入点。')
export const videoEditProgramPlaybackSchema = z.object({ frame: z.number().int().min(0).max(108000), playing: z.boolean(), playbackDirection: z.union([z.literal(1), z.literal(-1)]) }).strict()

/** Relations are local to a sequence. Breadth-first closure also handles linked groups. */
export function expandVideoEditSelection(sequence: VideoEditSequence, ids: readonly string[], relations = true): string[] {
  if (ids.length > 500) throw new Error('选区最多包含 500 个片段。')
  const clips = new Map(sequence.clips.map(clip => [clip.id, clip]))
  if (ids.some(id => !clips.has(id))) throw new Error('选区包含不属于此序列的片段。')
  const selected = new Set(ids)
  if (!relations) return [...selected]
  const links = new Map<string, string[]>(); const groups = new Map<string, string[]>()
  for (const clip of sequence.clips) {
    if (clip.linkId) links.set(clip.linkId, [...(links.get(clip.linkId) ?? []), clip.id])
    if (clip.groupId) groups.set(clip.groupId, [...(groups.get(clip.groupId) ?? []), clip.id])
  }
  const queue = [...selected]
  for (let index = 0; index < queue.length; index++) {
    const clip = clips.get(queue[index])!
    for (const id of [...(clip.linkId ? links.get(clip.linkId) ?? [] : []), ...(clip.groupId ? groups.get(clip.groupId) ?? [] : [])]) {
      if (!selected.has(id)) { selected.add(id); queue.push(id) }
    }
  }
  return [...selected]
}

export function selectVideoEditRegion(sequence: VideoEditSequence, region: { from: number; to: number; tracks: readonly number[] }): string[] {
  const from = Math.min(region.from, region.to); const to = Math.max(region.from, region.to)
  const tracks = new Set(region.tracks)
  return expandVideoEditSelection(sequence, sequence.clips.filter(clip => tracks.has(clip.track) && clip.start < to && clip.start + clip.duration > from).map(clip => clip.id))
}

export function selectVideoEditTrackFrom(sequence: VideoEditSequence, track: number, frame: number, allTracks = false): string[] {
  return expandVideoEditSelection(sequence, sequence.clips.filter(clip => (allTracks || clip.track === track) && clip.start + clip.duration > frame).map(clip => clip.id))
}
