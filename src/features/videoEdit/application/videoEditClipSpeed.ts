import type { JsonValue } from '@/core/application-control'
import type { VideoEditClip, VideoEditDocument, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditClipSpeedPercent, videoEditSpeedRatio } from '@/core/videoEdit/clipSpeed'
import { applyVideoEditSpeedChange, type VideoEditSpeedChange } from '@/core/videoEdit/clipSpeedEdits'
import { updateVideoEditClipStructure } from './videoEditCompositeEntities'

/**
 * 片段速度的助手属性（4.13）：`speed_percent`、`reverse`、`preserve_pitch` 三个通用属性，写入时与“速度/持续时间”
 * 对话框走同一个领域入口（`applyVideoEditSpeedChange`，不波纹：变长只用到后面片段之前的空白）。
 * 波纹调整后续片段可在同一事务里先移动后面的片段、再写速度，不另开专用能力。
 */
export const VIDEO_EDIT_SPEED_DATA_KEYS = ['speedPercent', 'reverse', 'preservePitch'] as const
type Data = Record<string, JsonValue>

/** 读回：速度百分比（100 为原速）、是否倒放、是否保持音调。 */
export function videoEditClipSpeedData(clip: VideoEditClip): { speedPercent: number; reverse: boolean; preservePitch: boolean } {
  return { speedPercent: videoEditClipSpeedPercent(clip), reverse: Boolean(clip.reverse), preservePitch: Boolean(clip.preservePitch) }
}

/** 片段属性写入：先按结构写入其余属性，再把写到的速度属性交给速度编辑（同一序列内换算时长与内容）。 */
export function updateVideoEditClipInSequence(document: VideoEditDocument, sequence: VideoEditSequence, clipId: string, data: Data, keys: string[]): VideoEditSequence {
  const { speedPercent, reverse, preservePitch, ...rest } = data
  const original = sequence.clips.find(clip => clip.id === clipId)
  if (!original) return sequence
  // 速度字段由速度编辑维护：结构写入时保持原值。
  const keep = { ...(original.speed ? { speed: original.speed } : {}), ...(original.reverse ? { reverse: true } : {}), ...(original.preservePitch ? { preservePitch: true } : {}) }
  const plain = Object.fromEntries(Object.entries(rest).filter(([key]) => !['speed', 'reverse', 'preservePitch'].includes(key)))
  const structured = updateVideoEditClipStructure(original, { ...plain, ...keep } as Data, keys.filter(key => !(VIDEO_EDIT_SPEED_DATA_KEYS as readonly string[]).includes(key)))
  const next = { ...sequence, clips: sequence.clips.map(clip => clip.id === clipId ? structured : clip) }
  const change: VideoEditSpeedChange = {
    ...(keys.includes('speedPercent') ? { speed: videoEditSpeedRatio(Number(speedPercent) / 100) } : {}),
    ...(keys.includes('reverse') ? { reverse: Boolean(reverse) } : {}),
    ...(keys.includes('preservePitch') ? { preservePitch: Boolean(preservePitch) } : {}),
  }
  if (!Object.keys(change).length) return next
  return applyVideoEditSpeedChange({ ...document, sequences: document.sequences.map(value => value.id === sequence.id ? next : value) }, sequence.id, [clipId], change)
}
