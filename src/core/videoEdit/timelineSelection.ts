import type { VideoEditSequence } from './document'
import { z } from 'zod'

export type VideoEditTimelineTool = 'select' | 'razor' | 'hand' | 'track'
export const videoEditTimelineViewSchema = z.object({
  selectedClipIds: z.array(z.string().min(1).max(100)).max(500), targetTrackIds: z.array(z.string().min(1).max(100)).max(32),
  tool: z.enum(['select', 'razor', 'hand', 'track']), snapping: z.boolean(), zoom: z.number().finite().min(.1).max(20),
  inFrame: z.number().int().min(0).max(108000).nullable(), outFrame: z.number().int().min(0).max(108000).nullable(),
  /** Premiere-style Linked Selection; omitted by older callers means unchanged/on. */
  linkedSelection: z.boolean().optional(),
}).strict().refine(view => view.inFrame === null || view.outFrame === null || view.outFrame > view.inFrame, '出点必须晚于入点。')
export const videoEditProgramPlaybackSchema = z.object({ frame: z.number().int().min(0).max(108000), playing: z.boolean(), playbackDirection: z.union([z.literal(1), z.literal(-1)]) }).strict()

/** Which relations a pick extends through; `true`/`false` mean both/neither. */
export type VideoEditRelations = boolean | { links: boolean; groups: boolean }
/**
 * Premiere: the Linked Selection toggle only governs links; picking a grouped clip always picks the
 * group. Alt/Option inverts Linked Selection for one gesture and singles a clip out of its group.
 */
export function videoEditPickRelations(linkedSelection: boolean, alt = false): { links: boolean; groups: boolean } { return { links: linkedSelection !== alt, groups: !alt } }

/** Relations are local to a sequence. Breadth-first closure also handles linked groups. */
export function expandVideoEditSelection(sequence: VideoEditSequence, ids: readonly string[], relations: VideoEditRelations = true): string[] {
  if (ids.length > 500) throw new Error('选区最多包含 500 个片段。')
  const clips = new Map(sequence.clips.map(clip => [clip.id, clip]))
  if (ids.some(id => !clips.has(id))) throw new Error('选区包含不属于此序列的片段。')
  const selected = new Set(ids)
  const links: boolean = typeof relations === 'boolean' ? relations : relations.links
  const groups: boolean = typeof relations === 'boolean' ? relations : relations.groups
  if (!links && !groups) return [...selected]
  const linked = new Map<string, string[]>(); const grouped = new Map<string, string[]>()
  for (const clip of sequence.clips) {
    if (links && clip.linkId) linked.set(clip.linkId, [...(linked.get(clip.linkId) ?? []), clip.id])
    if (groups && clip.groupId) grouped.set(clip.groupId, [...(grouped.get(clip.groupId) ?? []), clip.id])
  }
  const queue = [...selected]
  for (let index = 0; index < queue.length; index++) {
    const clip = clips.get(queue[index])!
    for (const id of [...(clip.linkId ? linked.get(clip.linkId) ?? [] : []), ...(clip.groupId ? grouped.get(clip.groupId) ?? [] : [])]) {
      if (!selected.has(id)) { selected.add(id); queue.push(id) }
    }
  }
  return [...selected]
}

export function selectVideoEditRegion(sequence: VideoEditSequence, region: { from: number; to: number; tracks: readonly number[] }, relations: VideoEditRelations = true): string[] {
  const from = Math.min(region.from, region.to); const to = Math.max(region.from, region.to)
  const tracks = new Set(region.tracks)
  return expandVideoEditSelection(sequence, sequence.clips.filter(clip => tracks.has(clip.track) && clip.start < to && clip.start + clip.duration > from).map(clip => clip.id), relations)
}

export function selectVideoEditTrackFrom(sequence: VideoEditSequence, track: number, frame: number, allTracks = false, relations: VideoEditRelations = true): string[] {
  return expandVideoEditSelection(sequence, sequence.clips.filter(clip => (allTracks || clip.track === track) && clip.start + clip.duration > frame).map(clip => clip.id), relations)
}
