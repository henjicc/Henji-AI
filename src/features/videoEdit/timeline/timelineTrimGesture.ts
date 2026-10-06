import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import type { VideoEditTrimMode } from '@/core/videoEdit/timelineTrims'
import type { VideoEditTimelineTool } from '@/core/videoEdit/timelineSelection'

/** 修剪工具在片段一端多近（像素）算抓住这一端（PR 光标在编辑点附近才变成修剪光标）。 */
export const TIMELINE_TRIM_EDGE_PIXELS = 10
export const TIMELINE_TRIM_TOOLS = new Set<VideoEditTimelineTool>(['ripple', 'roll', 'slip', 'slide'])
export function isTimelineTrimTool(tool: VideoEditTimelineTool): tool is VideoEditTrimMode { return TIMELINE_TRIM_TOOLS.has(tool) }

/**
 * 波纹／滚动编辑抓的是哪一端：命中裁剪柄就是那一端，否则看指针离起点还是终点更近（`frame` 可带小数）；
 * 两端都离得远时返回 undefined（只选中片段，不修剪）。
 */
export function timelineTrimEdge(clip: Pick<VideoEditClip, 'start' | 'duration'>, frame: number, pixels: number, handle?: string | null): 'in' | 'out' | undefined {
  if (handle === 'in' || handle === 'out') return handle
  const toStart = Math.abs(frame - clip.start) * pixels; const toEnd = Math.abs(clip.start + clip.duration - frame) * pixels
  const nearest = toStart <= toEnd ? 'in' : 'out'
  return Math.min(toStart, toEnd) <= TIMELINE_TRIM_EDGE_PIXELS ? nearest : undefined
}

/**
 * 拖动 `dx` 帧时请求的修剪量与参与吸附的边缘位置（拖动前的坐标）。外滑不移动任何边缘、不吸附；
 * 往右拖外滑露出更早的内容（与 PR 一致），所以源内容前进 `-dx` 帧。
 */
export function timelineTrimRequest(mode: VideoEditTrimMode, edge: 'in' | 'out' | undefined, clip: Pick<VideoEditClip, 'start' | 'duration'>, dx: number): { delta: number; edges: number[] } {
  if (mode === 'slip') return { delta: -dx, edges: [] }
  if (mode === 'slide') return { delta: dx, edges: [clip.start + dx, clip.start + clip.duration + dx] }
  return { delta: dx, edges: [(edge === 'in' ? clip.start : clip.start + clip.duration) + dx] }
}

/** 吸附时排除的片段：正在修剪的片段与和它们首尾相接的相邻片段（否则会吸回自己原来的位置）。 */
export function timelineTrimSnapExclusions(sequence: Pick<VideoEditSequence, 'clips'>, ids: readonly string[]): Set<string> {
  const edited = sequence.clips.filter(clip => ids.includes(clip.id))
  const touching = sequence.clips.filter(clip => edited.some(other => other.track === clip.track && (clip.start === other.start + other.duration || clip.start + clip.duration === other.start)))
  return new Set([...ids, ...touching.map(clip => clip.id)])
}
