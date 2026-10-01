import { z } from 'zod'
import type { VideoEditClip, VideoEditDocument, VideoEditSequence } from './document'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'
import { offsetVideoEditSource, videoEditSourceSeconds } from './time'

export const videoEditTransitionSchema = z.object({
  id: z.string().min(1).max(100), kind: z.literal('cross_dissolve'),
  leftClipId: z.string().min(1).max(100), rightClipId: z.string().min(1).max(100),
  durationFrames: z.number().int().min(2).max(108_000),
}).strict()
export type VideoEditTransition = z.infer<typeof videoEditTransitionSchema>
export interface VideoEditTransitionWindow { transition: VideoEditTransition; left: VideoEditClip; right: VideoEditClip; start: number; end: number; cut: number }

/** Derive every temporal field from the two original clips; never rewrite their clocks. */
export function videoEditTransitionWindow(sequence: Pick<VideoEditSequence, 'clips'>, transition: VideoEditTransition): VideoEditTransitionWindow {
  if (!Number.isInteger(transition.durationFrames) || transition.durationFrames < 2 || transition.durationFrames > 108_000) throw new Error('转场时长必须为2到108000的整数帧。')
  const left = sequence.clips.find(clip => clip.id === transition.leftClipId)
  const right = sequence.clips.find(clip => clip.id === transition.rightClipId)
  if (!left || !right || left === right || ['audio', 'adjustment'].includes(left.kind) || ['audio', 'adjustment'].includes(right.kind) || left.track !== right.track || left.start + left.duration !== right.start) throw new Error('交叉溶解需要同一画面轨道上紧邻的两个片段。')
  const cut = right.start; const start = cut - Math.floor(transition.durationFrames / 2); const end = cut + Math.ceil(transition.durationFrames / 2)
  if (start < left.start || end > right.start + right.duration) throw new Error('转场窗口超出两侧片段，请减小转场时长。')
  if (sequence.clips.some(clip => clip.track === left.track && clip.id !== left.id && clip.id !== right.id && clip.start < end && clip.start + clip.duration > start)) throw new Error('转场窗口内还有其他片段，请先调整剪辑位置。')
  return { transition, left, right, start, end, cut }
}
export function videoEditTransitionsAt(sequence: Pick<VideoEditSequence, 'clips' | 'transitions'>, frame: number): VideoEditTransitionWindow[] {
  return (sequence.transitions ?? []).map(transition => videoEditTransitionWindow(sequence, transition)).filter(window => frame >= window.start && frame < window.end)
}
export function videoEditTransitionAmount(window: Pick<VideoEditTransitionWindow, 'start' | 'end'>, frame: number): number {
  if (!Number.isInteger(window.start) || !Number.isInteger(window.end) || window.end - window.start < 2 || !Number.isInteger(frame) || frame < window.start || frame >= window.end) throw new Error('请求帧不在转场半开窗口内。')
  return (frame - window.start) / (window.end - window.start - 1)
}
function assertSourceHandles(document: VideoEditDocument, sequence: VideoEditSequence, window: VideoEditTransitionWindow, read?: CodeMaterialMetadataReader): void {
  for (const [clip, first, exclusiveEnd] of [[window.left, window.start, window.end], [window.right, window.start, window.end]] as const) {
    const durations: number[] = []
    if (clip.kind === 'video') {
      const item = document.items.find(item => item.id === clip.itemId)
      const media = document.media.find(media => media.id === item?.mediaId)
      if (!media || media.kind !== 'video') throw new Error('转场视频源素材不存在。')
      durations.push(media.durationSeconds)
    } else if (clip.kind === 'code') {
      if (!clip.code) throw new Error('转场代码片段缺少固定源码。')
      const program = read?.(clip.code)
      if (program?.mode === 'dynamic') durations.push(program.durationSeconds)
    }
    for (const effect of clip.effects ?? []) {
      const program = read?.(effect.code)
      if (program?.mode === 'dynamic') durations.push(program.durationSeconds)
    }
    if (!durations.length) continue // The source-authorized metadata stage checks deferred code handles.
    // This exact rational operation rejects a negative first sample. No frame allowance.
    offsetVideoEditSource(clip, first - clip.start, sequence.frameRate)
    const end = videoEditSourceSeconds(offsetVideoEditSource(clip, exclusiveEnd - clip.start, sequence.frameRate))
    for (const duration of durations) {
      const tolerance = 4 * Number.EPSILON * Math.max(1, Math.abs(end), duration)
      if (end > duration && end - duration > tolerance) throw new Error('转场需要的真实源余量不足，请裁出更多前后素材或减小时长。')
    }
  }
}
export function validateVideoEditTransitions(document: VideoEditDocument, read?: CodeMaterialMetadataReader): void {
  for (const sequence of document.sequences) {
    const windows = (sequence.transitions ?? []).map(transition => videoEditTransitionWindow(sequence, transition))
    for (let index = 0; index < windows.length; index++) {
      const window = windows[index]
      if (windows.slice(0, index).some(previous => previous.left.track === window.left.track && previous.start < window.end && previous.end > window.start)) throw new Error('同轨转场窗口不能重叠。')
      assertSourceHandles(document, sequence, window, read)
    }
  }
}

/** Deletion cascades; boundary-preserving split/overwrite explicitly supply their origin map. */
export function retimeVideoEditTransitions(before: Pick<VideoEditSequence, 'clips' | 'transitions' | 'frameRate'>, next: VideoEditSequence, origins: ReadonlyMap<string, { originalId: string; shift: number }> = new Map(), dropLostBoundary = false): VideoEditSequence {
  if (!before.transitions?.length || !next.transitions?.length) return next
  const resolve = (id: string, edge: 'in' | 'out'): string | undefined => {
    const original = before.clips.find(clip => clip.id === id)
    if (!original) return undefined
    const boundary = edge === 'in' ? original.start : original.start + original.duration
    const descendants = next.clips.filter(clip => clip.id === id || origins.get(clip.id)?.originalId === id)
    if (!descendants.length) return undefined
    const exact = descendants.find(clip => (edge === 'in' ? clip.start : clip.start + clip.duration) - (origins.get(clip.id)?.shift ?? 0) === boundary)
    // A normal trim keeps its ID and is subsequently validated, rather than silently losing the transition.
    return exact?.id ?? (dropLostBoundary ? undefined : descendants.find(clip => clip.id === id)?.id)
  }
  const previous = new Map(before.transitions.map(transition => [transition.id, transition]))
  return { ...next, transitions: next.transitions.flatMap(transition => {
    const old = previous.get(transition.id)
    if (!old || old.leftClipId !== transition.leftClipId || old.rightClipId !== transition.rightClipId) return [transition]
    const leftClipId = resolve(transition.leftClipId, 'out'); const rightClipId = resolve(transition.rightClipId, 'in')
    return leftClipId && rightClipId ? [{ ...transition, leftClipId, rightClipId }] : []
  }) }
}
