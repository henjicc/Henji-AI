import type { JsonValue } from '@/core/application-control'
import type { VideoEditClip, VideoEditDocument, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditClipSpeedPercent, videoEditSpeedRatio } from '@/core/videoEdit/clipSpeed'
import { videoEditFrameInterpolationSchema, videoEditTimeRemapSchema, type VideoEditFrameInterpolation, type VideoEditTimeRemap } from '@/core/videoEdit/timeRemap'
import { applyVideoEditSpeedChange, type VideoEditSpeedChange } from '@/core/videoEdit/clipSpeedEdits'
import { updateVideoEditClipStructure } from './videoEditCompositeEntities'
import { resolveVideoEditContentAnchor } from './videoEditContentAnchors'

/**
 * 片段速度的助手属性（4.13）：`speed_percent`、`reverse`、`preserve_pitch`、`time_remap`（速度曲线）、`frame_interpolation`（补帧）
 * 与 `pitch_semitones`（变调）通用属性，写入时与“速度/持续时间”
 * 对话框走同一个领域入口（`applyVideoEditSpeedChange`，不波纹：变长只用到后面片段之前的空白）。
 * 原子波纹变速走 ripple_video_edit_clip_speed，复用时间线 speed 编辑，不让助手手算后移量。
 */
export const VIDEO_EDIT_SPEED_DATA_KEYS = ['speedPercent', 'reverse', 'preservePitch', 'timeRemap', 'frameInterpolation', 'pitchSemitones'] as const
type Data = Record<string, JsonValue>

/** 读回：速度百分比（100 为原速；速度曲线片段为曲线最高速度）、倒放、保持音调、速度曲线、补帧与变调。 */
export function videoEditClipSpeedData(clip: VideoEditClip): { speedPercent: number; reverse: boolean; preservePitch: boolean; timeRemap: VideoEditTimeRemap | null; frameInterpolation: VideoEditFrameInterpolation; pitchSemitones: number } {
  return { speedPercent: videoEditClipSpeedPercent(clip), reverse: Boolean(clip.reverse), preservePitch: Boolean(clip.preservePitch), timeRemap: clip.timeRemap ?? null, frameInterpolation: clip.frameInterpolation ?? 'nearest', pitchSemitones: clip.pitchSemitones ?? 0 }
}

/** 片段属性写入：先按结构写入其余属性，再把写到的速度属性交给速度编辑（同一序列内换算时长与内容）。 */
export function updateVideoEditClipInSequence(document: VideoEditDocument, sequence: VideoEditSequence, clipId: string, data: Data, keys: string[]): VideoEditSequence {
  const { speedPercent, reverse, preservePitch, timeRemap, frameInterpolation, pitchSemitones, ...rest } = data
  const original = sequence.clips.find(clip => clip.id === clipId)
  if (!original) return sequence
  // 速度字段由速度编辑维护：结构写入时保持原值。
  const keep = { ...(original.speed ? { speed: original.speed } : {}), ...(original.reverse ? { reverse: true } : {}), ...(original.preservePitch ? { preservePitch: true } : {}), ...(original.timeRemap ? { timeRemap: original.timeRemap } : {}), ...(original.frameInterpolation ? { frameInterpolation: original.frameInterpolation } : {}), ...(original.pitchSemitones ? { pitchSemitones: original.pitchSemitones } : {}) }
  const plain = Object.fromEntries(Object.entries(rest).filter(([key]) => !['speed', 'reverse', 'preservePitch', 'timeRemap', 'frameInterpolation', 'pitchSemitones'].includes(key)))
  // 运动模糊与启用只存“关掉”：跟随序列总开关、启用时省略
  if (plain.motionBlur !== false) delete plain.motionBlur
  if (plain.enabled !== false) delete plain.enabled
  if (keys.includes('contentAnchor')) {
    const anchor = resolveVideoEditContentAnchor(document.id, sequence.id, clipId, data.contentAnchor ?? null)
    if (anchor) plain.contentAnchor = anchor
    else delete plain.contentAnchor
  }
  const structured = updateVideoEditClipStructure(original, { ...plain, ...keep } as Data, keys.filter(key => !(VIDEO_EDIT_SPEED_DATA_KEYS as readonly string[]).includes(key)))
  const next = { ...sequence, clips: sequence.clips.map(clip => clip.id === clipId ? structured : clip) }
  const change: VideoEditSpeedChange = {
    ...(keys.includes('speedPercent') ? { speed: videoEditSpeedRatio(Number(speedPercent) / 100) } : {}),
    ...(keys.includes('reverse') ? { reverse: Boolean(reverse) } : {}),
    ...(keys.includes('preservePitch') ? { preservePitch: Boolean(preservePitch) } : {}),
    ...(keys.includes('timeRemap') ? { timeRemap: timeRemap === null ? null : videoEditTimeRemapSchema.parse(timeRemap) } : {}),
    ...(keys.includes('frameInterpolation') ? { frameInterpolation: videoEditFrameInterpolationSchema.parse(frameInterpolation) } : {}),
    ...(keys.includes('pitchSemitones') ? { pitchSemitones: Number(pitchSemitones) } : {}),
  }
  if (!Object.keys(change).length) return next
  return applyVideoEditSpeedChange({ ...document, sequences: document.sequences.map(value => value.id === sequence.id ? next : value) }, sequence.id, [clipId], change)
}
