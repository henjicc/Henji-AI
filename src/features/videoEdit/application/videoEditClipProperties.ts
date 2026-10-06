import { videoEditClipSchema, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from '@/core/videoEdit/document'
import { editVideoProject, requireVideoEditInstance, updateVideoEditGesture, type VideoEditGesture } from './videoEditService'
import { putVideoEditKeyframe, videoEditKeyframesSchema, type VideoEditAnimatableKey, type VideoEditKeyframes } from '@/core/videoEdit/keyframes'

/** 效果控件里可直接调的片段固有属性（PR 的“运动 / 不透明度 / 音量”等固定效果）。 */
export type VideoEditClipPropertyKey = VideoEditAnimatableKey
export type VideoEditClipPropertyPatch = Partial<Pick<VideoEditClip, VideoEditClipPropertyKey | 'name' | 'text' | 'textStyle'>>

const PROPERTY_KEYS: readonly VideoEditClipPropertyKey[] = ['x', 'y', 'scale', 'rotation', 'anchorX', 'anchorY', 'opacity', 'brightness', 'volume']
const DEFAULTS: Record<VideoEditClipPropertyKey, number> = { x: 0, y: 0, scale: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1, brightness: 1, volume: 1 }

/** 取值范围只来自文档 schema：界面夹取与写入校验用同一组边界，拖动、步进和输入都产生不了非法值。 */
export function videoEditClipPropertyBounds(key: VideoEditClipPropertyKey): { min: number; max: number } {
  const raw = videoEditClipSchema.shape[key]
  const field = raw instanceof Object && 'unwrap' in raw ? raw.unwrap() : raw
  return { min: field.minValue ?? -Number.MAX_SAFE_INTEGER, max: field.maxValue ?? Number.MAX_SAFE_INTEGER }
}

/** 重置值：调整图层与音量为零的片段保持原有的“无声”约定，其余与新建片段一致。 */
export function videoEditClipPropertyDefault(clip: Pick<VideoEditClip, 'kind'>, key: VideoEditClipPropertyKey): number {
  return key === 'volume' && clip.kind === 'adjustment' ? 0 : DEFAULTS[key]
}

export function clampVideoEditClipProperty(key: VideoEditClipPropertyKey, value: number): number {
  if (!Number.isFinite(value)) throw new Error('数值无效。')
  const { min, max } = videoEditClipPropertyBounds(key)
  return Math.min(max, Math.max(min, value))
}

function normalizePatch(patch: VideoEditClipPropertyPatch): VideoEditClipPropertyPatch {
  const next: VideoEditClipPropertyPatch = { ...patch }
  for (const key of PROPERTY_KEYS) { const value = next[key]; if (value !== undefined) next[key] = clampVideoEditClipProperty(key, value) }
  if (next.name !== undefined) { next.name = next.name.trim(); if (!next.name) throw new Error('片段名称不能为空。') }
  return next
}

function patchDocument(sequenceId: string, clipId: string, patch: VideoEditClipPropertyPatch, frame: number) {
  return (document: VideoEditDocument): VideoEditDocument => {
    const sequence = document.sequences.find(value => value.id === sequenceId)
    if (!sequence) throw new Error('目标序列不存在。')
    if (!sequence.clips.some(clip => clip.id === clipId)) throw new Error('目标片段不存在。')
    const original = sequence.clips.find(clip => clip.id === clipId)!
    if (sequence.tracks.find(track => track.index === original.track)?.locked) throw new Error('所属轨道已锁定，请先解锁。')
    const next: VideoEditSequence = { ...sequence, clips: sequence.clips.map(clip => {
      if (clip.id !== clipId) return clip
      const result = { ...clip, ...patch }
      for (const key of PROPERTY_KEYS) if (patch[key] !== undefined && clip.curves?.[key]?.length) {
        const time = frame - clip.start
        if (time < 0 || time >= clip.duration) throw new Error(`请将播放头放在片段内（${clip.start}–${clip.start + clip.duration - 1} 帧）再编辑关键帧。`)
        Object.assign(result, { [key]: clip[key] })
        result.curves = { ...result.curves, [key]: putVideoEditKeyframe(clip.curves[key], { time, value: patch[key]!, interpolation: clip.curves[key]?.find(point => point.time === time)?.interpolation ?? 'linear' }) }
      }
      return result
    }) }
    return { ...document, sequences: document.sequences.map(value => value === sequence ? next : value) }
  }
}

/**
 * 改片段固有属性。带手势时只预览（拖动、连续输入期间实时出画面），由 `finishVideoEditGesture` 提交成一步撤销；
 * 不带手势时就是一次完整编辑（单击步进、输入后回车、重置）。数值先按 schema 边界夹取。
 */
export function updateVideoEditClipProperties(projectId: string, sequenceId: string, clipId: string, patch: VideoEditClipPropertyPatch, gesture?: VideoEditGesture): VideoEditDocument {
  const update = patchDocument(sequenceId, clipId, normalizePatch(patch), requireVideoEditInstance(projectId).frame)
  if (gesture) {
    if (gesture.projectId !== projectId) throw new Error('原参数调整已结束，请重新编辑。')
    return updateVideoEditGesture(gesture, update)
  }
  return editVideoProject(projectId, update)
}
/** UI and pen edits share the formal document validator, lock check and gesture undo. */
export function updateVideoEditClipKeyframes(projectId: string, sequenceId: string, clipId: string, key: VideoEditAnimatableKey, points: VideoEditKeyframes, gesture?: VideoEditGesture): void {
  const update = (document: VideoEditDocument): VideoEditDocument => {
    const sequence = document.sequences.find(value => value.id === sequenceId)
    const clip = sequence?.clips.find(value => value.id === clipId)
    if (!sequence || !clip) throw new Error('原片段已移除。')
    if (sequence.tracks.find(track => track.index === clip.track)?.locked) throw new Error('所属轨道已锁定，请先解锁。')
    const curves = { ...clip.curves, [key]: videoEditKeyframesSchema.parse(points) }
    if (!points.length) delete curves[key]
    const next = { ...clip, curves }
    return { ...document, sequences: document.sequences.map(value => value === sequence ? { ...sequence, clips: sequence.clips.map(value => value === clip ? next : value) } : value) }
  }
  if (gesture) {
    if (gesture.projectId !== projectId) throw new Error('原关键帧调整已结束。')
    updateVideoEditGesture(gesture, update)
  } else editVideoProject(projectId, update)
}
