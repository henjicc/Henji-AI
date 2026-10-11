import { compileCodeParameterTake } from '@/core/creativeIntent/codeParamAdapter'
import { compileMaskPathTake, type MaskPathPose } from '@/core/creativeIntent/maskPathAdapter'
import type { PropertySample } from '@/core/creativeIntent/propertyAdapter'
import type { ComputationControl } from '@/core/creativeIntent/sampling'
import { compareCodeMaterialTime } from '@/core/videoEdit/codeMaterialAnimation'
import { videoEditMaskShapeSchema, isShapesMask } from '@/core/videoEdit/effectMasks'
import { videoEditClipPictureSize } from '@/core/videoEdit/clipGeometry'
import { videoEditComposition } from '@/core/videoEdit/document'
import { readVideoEditCodeEditor, setVideoEditCodeParameterCurve, type VideoEditCodeTarget } from './videoEditCodeParameters'
import { updateVideoEditBuiltinEffect, type VideoEditCompositeTarget } from './videoEditCompositing'
import { requireVideoEditInstance } from './videoEditService'
import { createLogger } from '@/core/logging'

export interface VideoEditPathTarget extends VideoEditCompositeTarget { effectId: string; shapeId: string }
/** Read-only preview data; applying requires the original candidate and an unchanged native baseline. */
export interface VideoEditPropertyAnimationCandidate { kind: 'code-parameter' | 'mask-path'; keyCount: number }
const logger = createLogger('features.videoEdit.propertyAnimation')
const commits = new WeakMap<VideoEditPropertyAnimationCandidate, { target: VideoEditCompositeTarget; apply: () => void }>()
function logged<T>(action: string, target: VideoEditCompositeTarget, run: () => T): T {
  const context = { projectId: target.projectId, sequenceId: target.sequenceId, clipId: target.clipId }
  logger.info('参数动画操作开始', { event: `video_edit.property_animation.${action}.start`, context })
  try {
    const result = run()
    logger.info('参数动画操作完成', { event: `video_edit.property_animation.${action}.completed`, context })
    return result
  } catch (error) {
    logger.warn('参数动画操作未完成', { event: `video_edit.property_animation.${action}.failed`, context, error })
    throw error
  }
}
function resolve(target: VideoEditCompositeTarget) {
  const owner = requireVideoEditInstance(target.projectId)
  const composition = videoEditComposition(owner.document, target.sequenceId)
  const clip = composition.clips.find(c => c.id === target.clipId)
  if (!clip) throw new Error('目标片段已移除，请重新选择。')
  if (composition.tracks.find(t => t.index === clip.track)?.locked) throw new Error('所属轨道已锁定，请先解锁。')
  return { composition, clip }
}
function baseline(target: VideoEditCompositeTarget): string {
  const { clip, composition } = resolve(target)
  return JSON.stringify([clip, composition.frameRate, composition.width, composition.height])
}
function register<T extends VideoEditPropertyAnimationCandidate>(candidate: T, target: VideoEditCompositeTarget, base: string, commit: () => void): T {
  commits.set(candidate, { target, apply: () => { if (baseline(target) !== base) throw new Error('片段或动画已改变，请重新整理。'); commit() } })
  return candidate
}
function prepareCode(target: VideoEditCodeTarget, key: string, samples: readonly PropertySample<unknown>[], control: ComputationControl) {
  const base = baseline(target); const { clip, composition } = resolve(target)
  const editor = readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId, target.effectId)
  if (editor.target.versionId !== target.versionId) throw new Error('源码版本已改变，请重新选择。')
  const points = compileCodeParameterTake(editor.metadata, key, clip, composition.frameRate, samples, control)
  if (editor.curves[key]?.some(p => compareCodeMaterialTime(p, points[0]) < 0 || compareCodeMaterialTime(p, points.at(-1)!) > 0)) throw new Error('示范未覆盖已有参数曲线，请选择完整曲线后整理。')
  const value = structuredClone(points); const frozenTarget = { ...target }
  return register({ kind: 'code-parameter' as const, keyCount: points.length, points: structuredClone(points) }, frozenTarget, base, () => setVideoEditCodeParameterCurve(frozenTarget, key, value))
}
function prepareMask(target: VideoEditPathTarget, samples: readonly PropertySample<MaskPathPose>[], control: ComputationControl) {
  const base = baseline(target); const { clip, composition } = resolve(target)
  const mask = clip.effects?.find(e => e.id === target.effectId && e.builtin)?.mask
  if (!isShapesMask(mask)) throw new Error('请选择内置效果的手绘遮罩。')
  const shape = mask.shapes.find(s => s.id === target.shapeId)
  if (!shape) throw new Error('原遮罩已移除。')
  const animation = compileMaskPathTake(clip, composition.frameRate, videoEditClipPictureSize(composition, clip), samples, control)
  if (shape.pathAnimation && JSON.stringify(shape.pathAnimation.pointIds) !== JSON.stringify(animation.pointIds)) throw new Error('路径点对应已改变，请重新选择。')
  if (shape.pathAnimation?.keys.some(k => k.sourceTimeUs < animation.keys[0].sourceTimeUs || k.sourceTimeUs > animation.keys.at(-1)!.sourceTimeUs)) throw new Error('示范未覆盖已有路径动画，请选择完整路径后整理。')
  const next = videoEditMaskShapeSchema.parse({ ...shape, pathAnimation: animation })
  const replacement = structuredClone({ ...mask, shapes: mask.shapes.map(s => s.id === shape.id ? next : s) })
  const frozenTarget = { ...target }
  return register({ kind: 'mask-path' as const, keyCount: animation.keys.length, animation: structuredClone(animation) }, frozenTarget, base, () => updateVideoEditBuiltinEffect(frozenTarget, frozenTarget.effectId, { mask: replacement }))
}
export function applyVideoEditPropertyAnimation(candidate: VideoEditPropertyAnimationCandidate): void {
  const commit = commits.get(candidate)
  if (!commit) throw new Error('动画候选已失效，请重新整理。')
  logged('apply', commit.target, commit.apply); commits.delete(candidate)
}
export function prepareVideoEditCodeParameterAnimation(target: VideoEditCodeTarget, key: string, samples: readonly PropertySample<unknown>[], control: ComputationControl = {}) {
  return logged('prepare_code', target, () => prepareCode(target, key, samples, control))
}
export function prepareVideoEditMaskPathAnimation(target: VideoEditPathTarget, samples: readonly PropertySample<MaskPathPose>[], control: ComputationControl = {}) {
  return logged('prepare_mask', target, () => prepareMask(target, samples, control))
}
