import { videoEditClipSourceDuration, videoEditComposition, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from './document'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'
import { assertVideoEditClipsEditable } from './lockedTracks'
import type { VideoEditRatio } from './time'
import { retimeVideoEditContent } from './timedContent'
import { rescaleVideoEditClipKeyframes } from './keyframes'
import { retimeVideoEditAnnotations } from './timelineTrims'
import { changeVideoEditClipSpeed, setVideoEditClipReverse, stretchVideoEditClip, videoEditClipSpeedSupported, videoEditStretchDurationLimits } from './clipSpeed'

/**
 * 片段速度的编辑（4.13）：“速度/持续时间”对话框（Ctrl+R）、比率拉伸工具（R）与助手的速度属性都走这里，
 * 源时间换算全部委托 clipSpeed.ts。
 */
export interface VideoEditSpeedChange {
  /** 新速度；与 `duration` 二选一。改速度时开头的内容不动，时长按新速度换算。 */
  speed?: VideoEditRatio
  /** 新持续时间（帧）：用到的源内容不变，速度随之变化（与比率拉伸同一算法）。 */
  duration?: number
  reverse?: boolean
  preservePitch?: boolean
  /** 波纹编辑：同一轨道上后面的片段跟着前移／后移；关闭时变长只能用到后面片段之前的空白（PR）。 */
  ripple?: boolean
}
const end = (clip: Pick<VideoEditClip, 'start' | 'duration'>): number => clip.start + clip.duration
function sequenceLimit(fps: number): number { return Math.floor(fps * 1800) }
/** 不能改速度的片段说明原因（图片、文字、图形、调整图层没有可变速的源时间）。 */
export function assertVideoEditSpeedClips(clips: readonly VideoEditClip[]): void {
  const blocked = clips.find(clip => !videoEditClipSpeedSupported(clip.kind))
  if (blocked) throw new Error(`“${blocked.name}”不能改速度：只有视频、音频与代码素材片段有可变速的源时间。`)
}
function sourceDuration(document: VideoEditDocument, sequence: VideoEditSequence, clip: VideoEditClip, metadata?: CodeMaterialMetadataReader): number | undefined {
  const program = clip.code ? metadata?.(clip.code) : undefined
  if (program?.mode === 'dynamic') return program.durationSeconds
  return videoEditClipSourceDuration(videoEditComposition(document, sequence.id), clip)
}
/** 同轨道上 `clip` 之后最近的、不在 `excluded` 里的片段起点（没有时为序列上限）。 */
function nextStart(sequence: VideoEditSequence, clip: VideoEditClip, excluded: ReadonlySet<string>, limit: number): number {
  return Math.min(limit, ...sequence.clips.filter(other => other.track === clip.track && !excluded.has(other.id) && other.start >= end(clip)).map(other => other.start))
}
function previousEnd(sequence: VideoEditSequence, clip: VideoEditClip, excluded: ReadonlySet<string>): number {
  return Math.max(0, ...sequence.clips.filter(other => other.track === clip.track && !excluded.has(other.id) && end(other) <= clip.start).map(end))
}
function finish(sequence: VideoEditSequence, clips: VideoEditClip[], fps: number): VideoEditSequence {
  return retimeVideoEditContent(sequence, { ...sequence, clips, annotations: retimeVideoEditAnnotations(sequence, clips, fps) })
}

/** 对已经按链接选择展开好的片段应用速度、持续时间、倒放与保持音调。 */
export function applyVideoEditSpeedChange(document: VideoEditDocument, sequenceId: string, clipIds: readonly string[], change: VideoEditSpeedChange, metadata?: CodeMaterialMetadataReader): VideoEditSequence {
  const composition = videoEditComposition(document, sequenceId)
  const sequence = document.sequences.find(value => value.id === sequenceId)!
  const ids = new Set(clipIds)
  const edited = sequence.clips.filter(clip => ids.has(clip.id))
  if (!edited.length || edited.length !== ids.size) throw new Error('请先选择要改速度的片段。')
  if (change.speed && change.duration !== undefined) throw new Error('速度与持续时间只能改其中一个。')
  if (change.duration !== undefined && (!Number.isSafeInteger(change.duration) || change.duration < 1)) throw new Error('持续时间至少为 1 帧。')
  assertVideoEditClipsEditable(sequence, [...ids]); assertVideoEditSpeedClips(edited)
  const { fps } = composition; const limit = sequenceLimit(fps)
  const changed = new Map<string, VideoEditClip>()
  for (const clip of edited) {
    let next: VideoEditClip = clip
    if (change.reverse !== undefined) next = setVideoEditClipReverse(next, change.reverse, sequence.frameRate)
    if (change.preservePitch !== undefined) { next = { ...next }; if (change.preservePitch) next.preservePitch = true; else delete next.preservePitch }
    const room = change.ripple ? limit - clip.start : nextStart(sequence, clip, ids, limit) - clip.start
    if (change.duration !== undefined) next = stretchVideoEditClip(next, Math.min(change.duration, room))
    else if (change.speed) next = changeVideoEditClipSpeed(next, change.speed, fps, { sourceDurationSeconds: sourceDuration(document, sequence, clip, metadata), maxDuration: room })
    next = rescaleVideoEditClipKeyframes(next, time => Math.round(time * next.duration / clip.duration), next.duration)
    changed.set(clip.id, next)
  }
  let clips = sequence.clips.map(clip => changed.get(clip.id) ?? clip)
  if (change.ripple) {
    // 每条轨道上：一个片段的长度变化推动它之后的全部内容（含后面同样被改的片段）。
    const deltas = edited.map(clip => ({ track: clip.track, from: end(clip), delta: changed.get(clip.id)!.duration - clip.duration })).filter(value => value.delta)
    const shiftOf = (clip: VideoEditClip): number => deltas.reduce((sum, value) => sum + (value.track === clip.track && clip.start >= value.from ? value.delta : 0), 0)
    const moving = sequence.clips.filter(clip => shiftOf(clip) !== 0)
    assertVideoEditClipsEditable(sequence, moving.map(clip => clip.id))
    clips = clips.map(clip => { const original = sequence.clips.find(value => value.id === clip.id)!; const shift = shiftOf(original); return shift ? { ...clip, start: clip.start + shift } : clip })
    if (clips.some(clip => end(clip) > limit)) throw new Error('波纹编辑会让后面的片段超出序列最长 30 分钟，请先缩短序列。')
  }
  return finish(sequence, clips, fps)
}

/**
 * 比率拉伸工具（R）：拖片段一端改变长度，源内容不变、速度随之变化。`delta` 为请求的帧数（出点正数变长，入点正数变短，
 * 与修剪一致），超出 1%–10000% 或碰到相邻片段时收紧；返回实际帧数。
 */
export function applyVideoEditRateStretch(document: VideoEditDocument, sequenceId: string, clipIds: readonly string[], edge: 'in' | 'out', requested: number): { sequence: VideoEditSequence; delta: number } {
  if (!Number.isSafeInteger(requested)) throw new Error('拉伸帧数必须为整数。')
  const composition = videoEditComposition(document, sequenceId)
  const sequence = document.sequences.find(value => value.id === sequenceId)!
  const ids = new Set(clipIds)
  const edited = sequence.clips.filter(clip => ids.has(clip.id))
  if (!edited.length || edited.length !== ids.size) throw new Error('请先选择要拉伸的片段。')
  assertVideoEditClipsEditable(sequence, [...ids]); assertVideoEditSpeedClips(edited)
  const limit = sequenceLimit(composition.fps)
  let lo = -Infinity; let hi = Infinity
  for (const clip of edited) {
    const range = videoEditStretchDurationLimits(clip)
    if (edge === 'out') { lo = Math.max(lo, range.min - clip.duration); hi = Math.min(hi, range.max - clip.duration, nextStart(sequence, clip, ids, limit) - end(clip)) }
    else { lo = Math.max(lo, clip.duration - range.max, previousEnd(sequence, clip, ids) - clip.start); hi = Math.min(hi, clip.duration - range.min) }
  }
  const delta = lo > hi ? 0 : Math.max(lo, Math.min(hi, requested))
  if (!delta) return { sequence, delta: 0 }
  const clips = sequence.clips.map(clip => {
    if (!ids.has(clip.id)) return clip
    const raw = stretchVideoEditClip(clip, edge === 'out' ? clip.duration + delta : clip.duration - delta)
    const stretched = rescaleVideoEditClipKeyframes(raw, time => Math.round(time * raw.duration / clip.duration), raw.duration)
    return edge === 'in' ? { ...stretched, start: end(clip) - stretched.duration } : stretched
  })
  return { sequence: finish(sequence, clips, composition.fps), delta }
}
