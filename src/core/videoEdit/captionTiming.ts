import type { VideoEditSequence } from './document'
import type { VideoEditCaption } from './timedContent'
import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS, videoEditFps } from './time'
import { assertVideoEditClipsEditable } from './lockedTracks'

export type VideoEditCaptionGesture = 'move' | 'in' | 'out'

/** 字幕使用半开帧区间；移动保持时长，修剪保留至少一帧，到邻句或所属片段边界停止。 */
export function retimeVideoEditCaption(sequence: VideoEditSequence, id: string, mode: VideoEditCaptionGesture, delta: number): VideoEditCaption {
  const caption = sequence.captions?.find(value => value.id === id)
  if (!caption) throw new Error('原字幕已移除，请重新选择。')
  if (sequence.captionTrackLocked) throw new Error('字幕轨道已锁定，请先解锁再编辑。')
  if (caption.clipId) assertVideoEditClipsEditable(sequence, [caption.clipId])
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
