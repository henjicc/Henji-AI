import { videoEditClipSchema, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from '@/core/videoEdit/document'
import { editVideoProject, updateVideoEditGesture, type VideoEditGesture } from './videoEditService'

/** 效果控件里可直接调的片段固有属性（PR 的“运动 / 不透明度 / 音量”等固定效果）。 */
export type VideoEditClipPropertyKey = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'brightness' | 'volume'
export type VideoEditClipPropertyPatch = Partial<Pick<VideoEditClip, VideoEditClipPropertyKey | 'name' | 'text'>>

const PROPERTY_KEYS: readonly VideoEditClipPropertyKey[] = ['x', 'y', 'scale', 'rotation', 'opacity', 'brightness', 'volume']
const DEFAULTS: Record<VideoEditClipPropertyKey, number> = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1, volume: 1 }

/** 取值范围只来自文档 schema：界面夹取与写入校验用同一组边界，拖动、步进和输入都产生不了非法值。 */
export function videoEditClipPropertyBounds(key: VideoEditClipPropertyKey): { min: number; max: number } {
  const field = videoEditClipSchema.shape[key]
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

function patchDocument(sequenceId: string, clipId: string, patch: VideoEditClipPropertyPatch) {
  return (document: VideoEditDocument): VideoEditDocument => {
    const sequence = document.sequences.find(value => value.id === sequenceId)
    if (!sequence) throw new Error('目标序列不存在。')
    if (!sequence.clips.some(clip => clip.id === clipId)) throw new Error('目标片段不存在。')
    const next: VideoEditSequence = { ...sequence, clips: sequence.clips.map(clip => clip.id === clipId ? { ...clip, ...patch } : clip) }
    return { ...document, sequences: document.sequences.map(value => value === sequence ? next : value) }
  }
}

/**
 * 改片段固有属性。带手势时只预览（拖动、连续输入期间实时出画面），由 `finishVideoEditGesture` 提交成一步撤销；
 * 不带手势时就是一次完整编辑（单击步进、输入后回车、重置）。数值先按 schema 边界夹取。
 */
export function updateVideoEditClipProperties(projectId: string, sequenceId: string, clipId: string, patch: VideoEditClipPropertyPatch, gesture?: VideoEditGesture): VideoEditDocument {
  const update = patchDocument(sequenceId, clipId, normalizePatch(patch))
  if (gesture) {
    if (gesture.projectId !== projectId) throw new Error('原参数调整已结束，请重新编辑。')
    return updateVideoEditGesture(gesture, update)
  }
  return editVideoProject(projectId, update)
}
