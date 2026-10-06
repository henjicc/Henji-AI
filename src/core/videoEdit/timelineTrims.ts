import { adjustVideoEditClip, videoEditClipMedia, videoEditComposition, type VideoEditAnnotation, type VideoEditClip, type VideoEditComposition, type VideoEditDocument, type VideoEditSequence } from './document'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'
import { assertVideoEditClipsEditable } from './lockedTracks'
import { videoEditFps } from './time'
import { advanceVideoEditClipSource, videoEditClipContentShift, videoEditClipHeadRoom } from './clipSpeed'
import { retimeVideoEditContent } from './timedContent'
import { sliceVideoEditClipKeyframes } from './keyframes'

/**
 * Premiere 的修剪工具（剪辑对齐 PR 4.6），都只改片段的起点、长度与源入点：
 * - `ripple` 波纹编辑（B）：拖片段一端改长度，后面的片段（同步锁定的轨道）跟着前移／后移，不留空隙。
 *   `in` 端修剪时片段起点不动，剪掉或补回开头的内容，整段后续内容随之移动。
 * - `roll` 滚动编辑（N）：移动两段相接片段之间的编辑点，左段出点与右段入点一起变，总长不变；一侧是空白时就是普通修剪，不越过空白。
 * - `slip` 外滑（Y）：片段位置与长度不变，只换用素材里更早或更晚的一段（`delta` 为源内容沿播放方向前进的帧数，
  正数取播放顺序上更晚的内容；倒放片段即素材里更早的内容）。
 * - `slide` 内滑（U）：片段内容不变、整体左右移动，前一段的出点与后一段的入点跟着让位，总长不变。
 * `delta` 是请求的帧数，超出素材余量或相邻片段时收紧到能做到的最大值（`delta` 结果见返回值）。
 */
export type VideoEditTrimMode = 'ripple' | 'roll' | 'slip' | 'slide'
export interface VideoEditTrim { mode: VideoEditTrimMode; clipIds: readonly string[]; edge?: 'in' | 'out'; delta: number }
export interface VideoEditTrimResult { sequence: VideoEditSequence; delta: number }

const TIMED_KINDS = new Set<VideoEditClip['kind']>(['video', 'audio', 'code', 'graphic', 'adjustment'])
/** 与 adjustVideoEditClip 同一口径：有源时间的片段修剪入点时要平移源入点。 */
function timed(clip: VideoEditClip): boolean { return TIMED_KINDS.has(clip.kind) || Boolean(clip.effects?.length) }
const end = (clip: Pick<VideoEditClip, 'start' | 'duration'>): number => clip.start + clip.duration
interface Range { lo: number; hi: number }
function narrow(range: Range, lo: number, hi: number): void { range.lo = Math.max(range.lo, lo); range.hi = Math.min(range.hi, hi) }
function clampDelta(range: Range, delta: number): number { return range.lo > range.hi ? 0 : Math.max(range.lo, Math.min(range.hi, delta)) }

class TrimContext {
  readonly fps: number
  readonly limit: number
  constructor(readonly composition: VideoEditComposition, readonly sequence: VideoEditSequence, readonly metadata?: CodeMaterialMetadataReader) {
    this.fps = composition.fps; this.limit = Math.floor(composition.fps * 1800)
  }
  /** 开头还能往前补多少帧（沿播放方向在开头之前的素材，按片段速度换算）；没有源时间的片段不受限。 */
  head(clip: VideoEditClip): number {
    if (!timed(clip)) return Infinity
    const program = clip.code ? this.metadata?.(clip.code) : undefined
    return videoEditClipHeadRoom(clip, this.fps, program?.mode === 'dynamic' ? program.durationSeconds : videoEditClipMedia(this.composition, clip)?.durationSeconds)
  }
  /** 结尾还能往后延长多少帧（素材余量与序列上限）。 */
  tail(clip: VideoEditClip): number { return adjustVideoEditClip(this.composition, clip, { mode: 'out', delta: this.limit, track: clip.track }, this.metadata).duration - clip.duration }
  /** 同一轨道上紧贴片段之前／之后的那一段（不在 `excluded` 里）。 */
  adjacent(clip: VideoEditClip, side: 'before' | 'after', excluded: ReadonlySet<string>): VideoEditClip | undefined {
    return this.sequence.clips.find(other => other.track === clip.track && !excluded.has(other.id) && (side === 'before' ? end(other) === clip.start : other.start === end(clip)))
  }
  /** 同一轨道上片段之前最近的结束点（没有就是 0）与之后最近的起点（没有就是序列上限），不含 `excluded`。 */
  gap(clip: VideoEditClip, excluded: ReadonlySet<string>): { previous: number; next: number } {
    const others = this.sequence.clips.filter(other => other.track === clip.track && other.id !== clip.id && !excluded.has(other.id))
    return { previous: Math.max(0, ...others.filter(other => end(other) <= clip.start).map(end)), next: Math.min(this.limit, ...others.filter(other => other.start >= end(clip)).map(other => other.start)) }
  }
  /** 入点右移 `frames` 帧（负数左移）：起点、长度与源入点一起变。 */
  moveIn(clip: VideoEditClip, frames: number): VideoEditClip {
    return { ...sliceVideoEditClipKeyframes(clip, frames, clip.duration - frames), start: clip.start + frames, duration: clip.duration - frames, ...(timed(clip) && frames ? advanceVideoEditClipSource(clip, frames, this.sequence.frameRate) : {}) }
  }
}

function assertNoTrackOverlap(clips: readonly VideoEditClip[], message: string): void {
  const byTrack = new Map<number, VideoEditClip[]>()
  for (const clip of clips) byTrack.set(clip.track, [...(byTrack.get(clip.track) ?? []), clip])
  for (const lane of byTrack.values()) {
    const sorted = [...lane].sort((a, b) => a.start - b.start)
    for (let index = 1; index < sorted.length; index++) if (sorted[index].start < end(sorted[index - 1])) throw new Error(message)
  }
}
/** 片段上的标注随片段内容走：按起点与源入点的变化推算位移，落到片段外的去掉。 */
export function retimeVideoEditAnnotations(before: VideoEditSequence, clips: readonly VideoEditClip[], fps: number): VideoEditAnnotation[] {
  const prior = new Map(before.clips.map(clip => [clip.id, clip])); const after = new Map(clips.map(clip => [clip.id, clip]))
  return before.annotations.flatMap(mark => {
    const previous = prior.get(mark.clipId); const current = after.get(mark.clipId)
    if (!previous || !current) return []
    const shift = videoEditClipContentShift(previous, current, fps)
    const frame = mark.frame + shift
    return frame >= current.start && frame < end(current) ? [{ ...mark, frame }] : []
  })
}

function ripple(context: TrimContext, edited: VideoEditClip[], edge: 'in' | 'out', requested: number): { clips: VideoEditClip[]; delta: number } {
  const { sequence } = context
  const range: Range = { lo: -Infinity, hi: Infinity }
  for (const clip of edited) {
    if (edge === 'out') narrow(range, 1 - clip.duration, context.tail(clip))
    else narrow(range, -context.head(clip), clip.duration - 1)
  }
  const delta = clampDelta(range, requested)
  if (!delta) return { clips: sequence.clips, delta }
  // 出点延长 → 后面整体后移；入点剪掉开头 → 片段起点不动，后面整体前移。
  const shift = edge === 'out' ? delta : -delta
  const ids = new Set(edited.map(clip => clip.id))
  const pivots = new Map<number, number>()
  for (const clip of edited) pivots.set(clip.track, Math.min(pivots.get(clip.track) ?? Infinity, end(clip)))
  const pivot = Math.min(...pivots.values())
  // PR：波纹编辑推动所有开着同步锁定的轨道，以及被修剪片段所在的轨道。
  const affected = new Set([...edited.map(clip => clip.track), ...sequence.tracks.filter(track => track.syncLocked !== false).map(track => track.index)])
  const moving = sequence.clips.filter(clip => !ids.has(clip.id) && affected.has(clip.track) && clip.start >= (pivots.get(clip.track) ?? pivot))
  assertVideoEditClipsEditable(sequence, moving.map(clip => clip.id))
  const moved = new Set(moving.map(clip => clip.id))
  const clips = sequence.clips.map(clip => {
    if (ids.has(clip.id)) {
      if (edge === 'out') return { ...sliceVideoEditClipKeyframes(clip, 0, clip.duration + delta), duration: clip.duration + delta }
      const trimmed = context.moveIn(clip, delta)
      return { ...trimmed, start: clip.start }
    }
    return moved.has(clip.id) ? { ...clip, start: clip.start + shift } : clip
  })
  assertNoTrackOverlap(clips, '波纹修剪会让其他轨道上的片段重叠，请调整范围或关闭那条轨道的同步锁定。')
  return { clips, delta }
}

function roll(context: TrimContext, edited: VideoEditClip[], edge: 'in' | 'out', requested: number): { clips: VideoEditClip[]; delta: number } {
  const ids = new Set(edited.map(clip => clip.id))
  const pairs = new Map<string, { left?: VideoEditClip; right?: VideoEditClip }>()
  for (const clip of edited) {
    const pair = edge === 'out' ? { left: clip, right: context.adjacent(clip, 'after', ids) } : { left: context.adjacent(clip, 'before', ids), right: clip }
    pairs.set(`${pair.left?.id ?? ''}|${pair.right?.id ?? ''}`, pair)
  }
  const range: Range = { lo: -Infinity, hi: Infinity }
  for (const { left, right } of pairs.values()) {
    if (left) narrow(range, 1 - left.duration, context.tail(left))
    else narrow(range, context.gap(right!, ids).previous - right!.start, Infinity)
    if (right) narrow(range, -context.head(right), right.duration - 1)
    else narrow(range, -Infinity, context.gap(left!, ids).next - end(left!))
  }
  const delta = clampDelta(range, requested)
  if (!delta) return { clips: context.sequence.clips, delta }
  const changed = new Map<string, VideoEditClip>()
  for (const { left, right } of pairs.values()) {
    if (left) changed.set(left.id, { ...sliceVideoEditClipKeyframes(left, 0, left.duration + delta), duration: left.duration + delta })
    if (right) changed.set(right.id, context.moveIn(right, delta))
  }
  assertVideoEditClipsEditable(context.sequence, [...changed.keys()])
  return { clips: context.sequence.clips.map(clip => changed.get(clip.id) ?? clip), delta }
}

function slip(context: TrimContext, edited: VideoEditClip[], requested: number): { clips: VideoEditClip[]; delta: number } {
  const sources = edited.filter(timed)
  if (!sources.length) throw new Error('图片与文字片段没有前后余量，不能外滑。')
  const range: Range = { lo: -Infinity, hi: Infinity }
  for (const clip of sources) narrow(range, -context.head(clip), context.tail(clip))
  const delta = clampDelta(range, requested)
  if (!delta) return { clips: context.sequence.clips, delta }
  const changed = new Map(sources.map(clip => [clip.id, { ...clip, ...advanceVideoEditClipSource(clip, delta, context.sequence.frameRate) }]))
  return { clips: context.sequence.clips.map(clip => changed.get(clip.id) ?? clip), delta }
}

function slide(context: TrimContext, edited: VideoEditClip[], requested: number): { clips: VideoEditClip[]; delta: number } {
  const ids = new Set(edited.map(clip => clip.id))
  const range: Range = { lo: -Infinity, hi: Infinity }
  const neighbours = edited.map(clip => {
    const left = context.adjacent(clip, 'before', ids); const right = context.adjacent(clip, 'after', ids); const gap = context.gap(clip, ids)
    narrow(range, -clip.start, context.limit - end(clip))
    if (left) narrow(range, 1 - left.duration, context.tail(left))
    else narrow(range, gap.previous - clip.start, Infinity)
    if (right) narrow(range, -context.head(right), right.duration - 1)
    else narrow(range, -Infinity, gap.next - end(clip))
    return { clip, left, right }
  })
  const delta = clampDelta(range, requested)
  if (!delta) return { clips: context.sequence.clips, delta }
  const changed = new Map<string, VideoEditClip>()
  for (const { clip, left, right } of neighbours) {
    changed.set(clip.id, { ...clip, start: clip.start + delta })
    if (left) changed.set(left.id, { ...sliceVideoEditClipKeyframes(left, 0, left.duration + delta), duration: left.duration + delta })
    if (right) changed.set(right.id, context.moveIn(right, delta))
  }
  assertVideoEditClipsEditable(context.sequence, [...changed.keys()])
  const clips = context.sequence.clips.map(clip => changed.get(clip.id) ?? clip)
  assertNoTrackOverlap(clips, '内滑会让片段重叠，请先调整相邻片段。')
  return { clips, delta }
}

/** 执行一次修剪；`trim.clipIds` 是已经按链接选择展开好的片段（链接的音画一起修剪）。 */
export function applyVideoEditTrim(document: VideoEditDocument, sequenceId: string, trim: VideoEditTrim, metadata?: CodeMaterialMetadataReader): VideoEditTrimResult {
  if (!Number.isSafeInteger(trim.delta)) throw new Error('修剪帧数必须为整数。')
  const composition = videoEditComposition(document, sequenceId)
  const sequence = document.sequences.find(value => value.id === sequenceId)!
  const ids = new Set(trim.clipIds)
  const edited = sequence.clips.filter(clip => ids.has(clip.id))
  if (!edited.length || edited.length !== ids.size) throw new Error('请先选择要修剪的片段。')
  assertVideoEditClipsEditable(sequence, [...ids])
  if ((trim.mode === 'ripple' || trim.mode === 'roll') && !trim.edge) throw new Error('波纹编辑与滚动编辑需要指定修剪入点还是出点。')
  const context = new TrimContext(composition, sequence, metadata)
  const result = trim.mode === 'ripple' ? ripple(context, edited, trim.edge!, trim.delta) : trim.mode === 'roll' ? roll(context, edited, trim.edge!, trim.delta) : trim.mode === 'slip' ? slip(context, edited, trim.delta) : slide(context, edited, trim.delta)
  if (!result.delta) return { sequence, delta: 0 }
  const fps = videoEditFps(sequence.frameRate)
  return { sequence: retimeVideoEditContent(sequence, { ...sequence, clips: result.clips, annotations: retimeVideoEditAnnotations(sequence, result.clips, fps) }), delta: result.delta }
}
