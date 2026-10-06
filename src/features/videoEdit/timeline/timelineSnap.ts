import { useSyncExternalStore } from 'react'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditEditPoints } from '@/core/videoEdit/timelineNavigation'

/**
 * 时间线吸附与吸附提示线（PR 的吸附指示器）：拖动片段、裁剪、Shift 拖播放头、拖过渡块与淡化手柄、拖入素材的落点、
 * 拖标尺入出点时，吸上的那一帧在轨道上显示一条竖线。所有吸附都经过这里，提示线只有这一份状态。
 */
export interface TimelineSnapIndicator { readonly sequenceId: string; readonly frame: number }
/** 吸附距离：屏幕上 8 像素换算成帧。 */
export const TIMELINE_SNAP_PIXELS = 8
let indicator: TimelineSnapIndicator | null = null
const listeners = new Set<() => void>()
function publish(next: TimelineSnapIndicator | null): void {
  if (indicator === next || indicator && next && indicator.sequenceId === next.sequenceId && indicator.frame === next.frame) return
  indicator = next
  listeners.forEach(listener => listener())
}
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function readTimelineSnapIndicator(): TimelineSnapIndicator | null { return indicator }
/** 时间线画布读提示线（只显示属于这个序列的那条）。 */
export function useTimelineSnapIndicator(sequenceId: string): number | null {
  const value = useSyncExternalStore(subscribe, readTimelineSnapIndicator)
  return value && value.sequenceId === sequenceId ? value.frame : null
}
/** 手势结束、取消或拖出时间线时收起提示线。 */
export function clearTimelineSnap(): void { publish(null) }

/** 常用吸附点：播放头、编辑点（可排除正在拖的片段）、序列开头与标记。 */
export function timelineSnapPoints(sequence: Pick<VideoEditSequence, 'clips' | 'markers'>, options: { playhead?: number; excludeClipIds?: ReadonlySet<string>; extra?: readonly number[] } = {}): number[] {
  const clips = options.excludeClipIds ? sequence.clips.filter(clip => !options.excludeClipIds!.has(clip.id)) : sequence.clips
  return [0, ...(options.playhead === undefined ? [] : [options.playhead]), ...videoEditEditPoints({ clips }), ...(sequence.markers ?? []).map(mark => mark.frame), ...(options.extra ?? [])]
}
/**
 * 一组一起移动的边缘（如过渡块两缘）里离吸附点最近的那个吸上：返回要补的偏移（没吸上为 0），并更新提示线。
 * `threshold` 为帧数；正好落在吸附点上也算吸上（PR 照样显示提示线）。
 */
export function snapTimelineEdges(sequenceId: string, points: readonly number[], edges: readonly number[], threshold: number): number {
  let best: { offset: number; frame: number } | undefined
  for (const edge of edges) for (const point of points) {
    const offset = point - edge
    if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { offset, frame: point }
  }
  publish(best ? { sequenceId, frame: best.frame } : null)
  return best?.offset ?? 0
}
/** 单个帧位置的吸附（播放头、手柄、落点）：返回吸附后的帧。 */
export function snapTimelineFrame(sequenceId: string, points: readonly number[], frame: number, threshold: number): number {
  return frame + snapTimelineEdges(sequenceId, points, [frame], threshold)
}
/**
 * 由编辑领域自己完成吸附的拖动（片段移动、裁剪、修饰键重排）只报告结果：移动后的边缘正好落在吸附点上时显示提示线。
 */
export function reportTimelineSnap(sequenceId: string, points: readonly number[], edges: readonly number[]): void {
  const set = new Set(points)
  const frame = edges.find(edge => set.has(edge))
  publish(frame === undefined ? null : { sequenceId, frame })
}
