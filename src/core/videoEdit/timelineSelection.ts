import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from './time'
import type { VideoEditSequence } from './document'
import { z } from 'zod'

/**
 * 时间线工具（模式），与 Premiere 工具面板一致（剪辑对齐 PR 4.6）：选择、向前／向后选择轨道、波纹编辑、滚动编辑、剃刀、
 * 外滑、内滑、手形、缩放、文字；比率拉伸（4.13）拖片段一端改变速度而不是源范围。钢笔 P 编辑片段不透明度／音量关键帧。
 */
export const VIDEO_EDIT_TIMELINE_TOOLS = ['select', 'track', 'track_backward', 'ripple', 'roll', 'rate_stretch', 'razor', 'slip', 'slide', 'pen', 'hand', 'zoom', 'type'] as const
export type VideoEditTimelineTool = typeof VIDEO_EDIT_TIMELINE_TOOLS[number]
export const videoEditTimelineViewSchema = z.object({
  selectedClipIds: z.array(z.string().min(1).max(100)), targetTrackIds: z.array(z.string().min(1).max(100)),
  tool: z.enum(VIDEO_EDIT_TIMELINE_TOOLS), snapping: z.boolean(), zoom: z.number().finite().min(.1).max(20),
  inFrame: z.number().int().min(0).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES).nullable(), outFrame: z.number().int().min(0).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES).nullable(),
  /** Premiere-style Linked Selection; omitted by older callers means unchanged/on. */
  linkedSelection: z.boolean().optional(),
}).strict().refine(view => view.inFrame === null || view.outFrame === null || view.outFrame > view.inFrame, '出点必须晚于入点。')
export const videoEditProgramPlaybackSchema = z.object({ frame: z.number().int().min(0).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES), playing: z.boolean(), playbackDirection: z.union([z.literal(1), z.literal(-1)]) }).strict()

/** Which relations a pick extends through; `true`/`false` mean both/neither. */
export type VideoEditRelations = boolean | { links: boolean; groups: boolean }
/**
 * Premiere: the Linked Selection toggle only governs links; picking a grouped clip always picks the
 * group. Alt/Option inverts Linked Selection for one gesture and singles a clip out of its group.
 */
export function videoEditPickRelations(linkedSelection: boolean, alt = false): { links: boolean; groups: boolean } { return { links: linkedSelection !== alt, groups: !alt } }

/** Relations are local to a sequence. Breadth-first closure also handles linked groups. */
export function expandVideoEditSelection(sequence: VideoEditSequence, ids: readonly string[], relations: VideoEditRelations = true): string[] {
  const clips = new Map(sequence.clips.map(clip => [clip.id, clip]))
  if (ids.some(id => !clips.has(id))) throw new Error('选区包含不属于此序列的片段。')
  const selected = new Set(ids)
  const links: boolean = typeof relations === 'boolean' ? relations : relations.links
  const groups: boolean = typeof relations === 'boolean' ? relations : relations.groups
  if (!links && !groups) return [...selected]
  const linked = new Map<string, string[]>(); const grouped = new Map<string, string[]>()
  for (const clip of sequence.clips) {
    if (links && clip.linkId) { const values = linked.get(clip.linkId) ?? []; values.push(clip.id); linked.set(clip.linkId, values) }
    if (groups && clip.groupId) { const values = grouped.get(clip.groupId) ?? []; values.push(clip.id); grouped.set(clip.groupId, values) }
  }
  const queue = [...selected]
  for (let index = 0; index < queue.length; index++) {
    const clip = clips.get(queue[index])!
    for (const id of [...(clip.linkId ? linked.get(clip.linkId) ?? [] : []), ...(clip.groupId ? grouped.get(clip.groupId) ?? [] : [])]) {
      if (!selected.has(id)) { selected.add(id); queue.push(id) }
    }
    if (clip.linkId) linked.delete(clip.linkId)
    if (clip.groupId) grouped.delete(clip.groupId)
  }
  return [...selected]
}

export function selectVideoEditRegion(sequence: VideoEditSequence, region: { from: number; to: number; tracks: readonly number[] }, relations: VideoEditRelations = true): string[] {
  const from = Math.min(region.from, region.to); const to = Math.max(region.from, region.to)
  const tracks = new Set(region.tracks)
  return expandVideoEditSelection(sequence, sequence.clips.filter(clip => tracks.has(clip.track) && clip.start < to && clip.start + clip.duration > from).map(clip => clip.id), relations)
}

/**
 * 轨道选择工具：`forward` 选点击处及之后的片段（向前选择轨道 A），`backward` 选点击处及之前的片段（向后选择轨道 Shift+A）；
 * PR 默认作用于全部轨道，按住 Shift 只选点击的那一条轨道。
 */
export function selectVideoEditTrackFrom(sequence: VideoEditSequence, track: number, frame: number, allTracks = false, relations: VideoEditRelations = true, direction: 'forward' | 'backward' = 'forward'): string[] {
  return expandVideoEditSelection(sequence, sequence.clips.filter(clip => (allTracks || clip.track === track) && (direction === 'forward' ? clip.start + clip.duration > frame : clip.start <= frame)).map(clip => clip.id), relations)
}
