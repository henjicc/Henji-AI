import type { VideoEditSequence } from './document'
import type { VideoEditCaption } from './timedContent'
import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS, videoEditFps } from './time'
import { assertVideoEditClipsEditable } from './lockedTracks'
import { videoEditCaptionClipIds } from './captionSpeech'

export type VideoEditCaptionGesture = 'move' | 'in' | 'out'

/** 字幕使用半开帧区间；移动保持时长，修剪保留至少一帧，到邻句或所属片段边界停止。 */
export function retimeVideoEditCaption(sequence: VideoEditSequence, id: string, mode: VideoEditCaptionGesture, delta: number): VideoEditCaption {
  const caption = sequence.captions?.find(value => value.id === id)
  if (!caption) throw new Error('原字幕已移除，请重新选择。')
  if (sequence.captionTrackLocked) throw new Error('字幕轨道已锁定，请先解锁再编辑。')
  assertVideoEditClipsEditable(sequence, videoEditCaptionClipIds(caption))
  const owner = sequence.clips.find(clip => clip.id === caption.clipId)
  let from = owner?.start ?? 0
  let to = owner ? owner.start + owner.duration : Math.floor(videoEditFps(sequence.frameRate) * VIDEO_EDIT_MAX_SEQUENCE_SECONDS)
  const end = caption.start + caption.duration
  for (const other of sequence.captions ?? []) {
    if (other.id === id) continue
    if (other.start + other.duration <= caption.start) from = Math.max(from, other.start + other.duration)
    else if (other.start >= end) to = Math.min(to, other.start)
    else return caption // 已有重叠字幕不在拖动时猜测先后或改写其他句。
  }
  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
  const offset = Math.round(delta)
  const start = mode === 'out' ? caption.start : clamp(caption.start + offset, from, mode === 'move' ? to - caption.duration : end - 1)
  const finish = mode === 'move' ? start + caption.duration : mode === 'in' ? end : clamp(end + offset, caption.start + 1, to)
  return { ...caption, start, duration: finish - start }
}

/** 连着拖时，间隙不超过这么多秒的邻句算挨着（与字幕规则“间隙不到半秒就接上”一致）。 */
const ROLL_GAP_SECONDS = 0.5

/**
 * 按住 Ctrl 或 Alt 修剪一条边：挨着这条边的邻句（相连或间隙不超过半秒）的另一条边跟着走，两句在拖到的位置接上，
 * 各保留至少一帧、不出各自所属片段；没有挨着的邻句时就是普通修剪。返回要更新的一到两句。
 */
export function rollVideoEditCaptions(sequence: VideoEditSequence, id: string, edge: 'in' | 'out', delta: number): VideoEditCaption[] {
  const caption = sequence.captions?.find(value => value.id === id)
  if (!caption) throw new Error('原字幕已移除，请重新选择。')
  const fps = videoEditFps(sequence.frameRate)
  const gap = Math.round(ROLL_GAP_SECONDS * fps)
  const end = caption.start + caption.duration
  const others = (sequence.captions ?? []).filter(value => value.id !== id)
  const neighbor = edge === 'out'
    ? others.filter(value => value.start >= end && value.start - end <= gap).sort((a, b) => a.start - b.start)[0]
    : others.filter(value => value.start + value.duration <= caption.start && caption.start - value.start - value.duration <= gap).sort((a, b) => b.start + b.duration - a.start - a.duration)[0]
  if (!neighbor) return [retimeVideoEditCaption(sequence, id, edge, delta)]
  if (sequence.captionTrackLocked) throw new Error('字幕轨道已锁定，请先解锁再编辑。')
  assertVideoEditClipsEditable(sequence, [...videoEditCaptionClipIds(caption), ...videoEditCaptionClipIds(neighbor)])
  const [first, second] = edge === 'out' ? [caption, neighbor] : [neighbor, caption]
  const secondEnd = second.start + second.duration
  // 两句之间还有别的字幕（重叠的旧数据）时不猜测，原样不动。
  if (others.some(value => value !== neighbor && value.start < secondEnd && value.start + value.duration > first.start)) return [caption]
  const firstOwner = sequence.clips.find(clip => clip.id === first.clipId)
  const secondOwner = sequence.clips.find(clip => clip.id === second.clipId)
  const low = Math.max(first.start + 1, secondOwner?.start ?? 0)
  const high = Math.min(secondEnd - 1, firstOwner ? firstOwner.start + firstOwner.duration : Number.MAX_SAFE_INTEGER)
  if (low > high) return [caption]
  const boundary = Math.max(low, Math.min(high, (edge === 'out' ? end : caption.start) + Math.round(delta)))
  return [{ ...first, duration: boundary - first.start }, { ...second, start: boundary, duration: secondEnd - boundary }]
}
