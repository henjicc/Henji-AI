import { requireVideoEditBuiltinEffect } from '@/core/videoEdit/builtinEffects'
import type { VideoEditAnimatableKey, VideoEditKeyframe } from '@/core/videoEdit/keyframes'
import type { VideoEditBuiltinAnimationField, VideoEditKeyframeChanges, VideoEditKeyframeLaneSource } from '@/core/videoEdit/keyframeLanes'
import { builtinParameterFields, type ParamFieldSpec } from '@/components/ui/params/fieldSpec'
import { beginVideoEditGesture, finishVideoEditGesture, requireVideoEditInstance, type VideoEditGesture } from './videoEditService'
import { updateVideoEditClipKeyframes, updateVideoEditClipProperties, type VideoEditClipPropertyPatch } from './videoEditClipProperties'
import { updateVideoEditBuiltinEffect } from './videoEditCompositing'

/** 只能定格的参数（开关、选项、曲线、LUT）：关键帧之间不插值。效果控件与时间线关键帧行共用。 */
export function isVideoEditDiscreteField(field: Pick<ParamFieldSpec, 'type'>): boolean {
  return field.type === 'boolean' || field.type === 'choice' || field.type === 'curve' || field.type === 'lut'
}

/** 内置效果可做动画的参数行，与效果控件里的行一一对应（点位的水平、垂直合成一行）。 */
export function videoEditBuiltinAnimationFields(builtinId: string): VideoEditBuiltinAnimationField[] {
  return builtinParameterFields(requireVideoEditBuiltinEffect(builtinId).params).filter(field => field.animatable)
    .map(field => ({ key: field.key, title: field.group ? `${field.group} · ${field.title}` : field.title, keys: field.bindingKeys, discrete: isVideoEditDiscreteField(field) }))
}

export interface VideoEditKeyframeLaneTarget { projectId: string; sequenceId: string; clipId: string; source: VideoEditKeyframeLaneSource }

/**
 * 时间线关键帧行的写入（重要记录 019）：一个片段在一行里各分量的关键帧一起改，记成一步撤销；传入手势时并进那次拖动。
 * 删光某分量时 `statics` 给出留作静态值的数值。固有属性与内置效果各走自己的正式写入口（校验、锁定检查同效果控件）。
 */
export function writeVideoEditKeyframeLane(target: VideoEditKeyframeLaneTarget, changes: VideoEditKeyframeChanges, statics: Readonly<Record<string, VideoEditKeyframe['value']>> = {}, gesture?: VideoEditGesture): void {
  const { projectId, sequenceId, clipId, source } = target
  if (!Object.keys(changes).length && !Object.keys(statics).length) return
  const handle = gesture ?? beginVideoEditGesture(projectId)
  try {
    if (source.kind === 'intrinsic') {
      for (const [key, points] of Object.entries(changes)) updateVideoEditClipKeyframes(projectId, sequenceId, clipId, key as VideoEditAnimatableKey, points, handle)
      if (Object.keys(statics).length) updateVideoEditClipProperties(projectId, sequenceId, clipId, statics as VideoEditClipPropertyPatch, handle)
    } else {
      const effect = requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === sequenceId)?.clips.find(clip => clip.id === clipId)?.effects?.find(effect => effect.id === source.effectId)
      if (!effect?.builtin) throw new Error('原内置效果已移除。')
      const curves = { ...effect.builtin.curves }
      for (const [key, points] of Object.entries(changes)) { if (points.length) curves[key] = points; else delete curves[key] }
      updateVideoEditBuiltinEffect({ projectId, sequenceId, clipId }, source.effectId, { curves, ...(Object.keys(statics).length ? { params: statics } : {}) }, handle)
    }
    if (!gesture) finishVideoEditGesture(handle)
  } catch (error) {
    if (!gesture) finishVideoEditGesture(handle, false)
    throw error
  }
}
