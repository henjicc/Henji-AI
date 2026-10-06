import { createLogger } from '@/core/logging'
import { videoEditComposition } from '@/core/videoEdit/document'
import { VIDEO_EDIT_MAX_EFFECTS } from '@/core/videoEdit/compositing'
import { VIDEO_EDIT_LUMETRI, suggestLumetriAutoColor } from '@/core/videoEdit/lumetri'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { editVideoProject, requireVideoEditInstance, updateVideoEditGesture, type VideoEditGesture } from './videoEditService'
import { makeVideoEditBuiltinEffect, updateVideoEditBuiltinEffect, type VideoEditBuiltinEffectChanges, type VideoEditCompositeTarget } from './videoEditCompositing'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'

const logger = createLogger('features.videoEdit.lumetri')
/** First edit creates the effect inside the same gesture. Cancelling also removes the newly created effect. */
export function editVideoEditLumetri(target: VideoEditCompositeTarget, changes: Pick<VideoEditBuiltinEffectChanges, 'params' | 'curves'>, gesture?: VideoEditGesture, effectId?: string): void {
  if (gesture && gesture.projectId !== target.projectId) throw new Error('参数手势必须属于目标剪辑。')
  const owner = requireVideoEditInstance(target.projectId)
  const sequence = owner.document.sequences.find(value => value.id === target.sequenceId)
  const clip = sequence?.clips.find(value => value.id === target.clipId)
  if (!sequence || !clip) throw new Error('原片段已移除。')
  const effect = effectId ? clip.effects?.find(value => value.id === effectId) : clip.effects?.find(value => value.builtin?.id === 'lumetri_color')
  if (effectId && effect?.builtin?.id !== VIDEO_EDIT_LUMETRI.id) throw new Error('原 Lumetri 颜色效果已移除，请重新选择。')
  if (effect) { updateVideoEditBuiltinEffect(target, effect.id, changes, gesture); return }
  assertVideoEditClipsEditable(sequence, [clip.id])
  if (clip.kind === 'audio') throw new Error('请选择画面片段。')
  if ((clip.effects?.length ?? 0) >= VIDEO_EDIT_MAX_EFFECTS) throw new Error(`片段最多只能放${VIDEO_EDIT_MAX_EFFECTS}项效果，请先删除不用的效果。`)
  const created = makeVideoEditBuiltinEffect(VIDEO_EDIT_LUMETRI.id, changes.params)
  if (changes.curves) created.builtin!.curves = changes.curves
  const update = (document: typeof owner.document): typeof owner.document => ({ ...document, sequences: document.sequences.map(value => value.id === sequence.id ? { ...value, clips: value.clips.map(value => value.id === clip.id ? { ...value, effects: [...(value.effects ?? []), created] } : value) } : value) })
  if (gesture) updateVideoEditGesture(gesture, update); else editVideoProject(target.projectId, update)
}

/** Same production renderer/trial queue as preview/export; isolate the selected clip before its selected Lumetri.
 * No asset/file writes, no changes to transport. Suggestions are absolute basic-correction values. */
export async function analyzeVideoEditLumetri(target: VideoEditCompositeTarget, frame?: number, signal = new AbortController().signal, effectId?: string) {
  const started = performance.now(); const owner = requireVideoEditInstance(target.projectId); const snapshot = owner.document
  const sequence = snapshot.sequences.find(value => value.id === target.sequenceId); const clip = sequence?.clips.find(value => value.id === target.clipId)
  if (!sequence || !clip || clip.kind === 'audio' || clip.kind === 'adjustment') throw new Error('请选择带画面的片段，调整图层和声音片段不能自动校色。')
  const at = frame ?? (owner.frame >= clip.start && owner.frame < clip.start + clip.duration ? owner.frame : clip.start + Math.floor(clip.duration / 2))
  if (!Number.isSafeInteger(at) || at < clip.start || at >= clip.start + clip.duration) throw new Error('分析帧必须在目标片段的时间范围内。')
  const composition = videoEditComposition(snapshot, sequence.id)
  const stop = clip.effects?.findIndex(effect => effectId ? effect.id === effectId : effect.builtin?.id === 'lumetri_color') ?? -1
  if (effectId && stop < 0) throw new Error('原 Lumetri 颜色效果已移除。')
  const isolated = { ...composition, annotations: [], captions: [], transitions: [], clips: composition.clips.filter(value => value.id === clip.id).map(value => ({ ...value, opacity: 1, effects: stop < 0 ? value.effects : value.effects?.slice(0, stop) })), tracks: composition.tracks.map(value => ({ ...value, enabled: value.index === clip.track, solo: false })) }
  logger.info('自动校色分析开始', { event: 'video_edit.lumetri.analyze.start', context: { projectId: target.projectId, clipId: clip.id, frame: at } })
  try {
    const bitmap = await trialVideoEditCodeFrames([{ document: isolated, frame: at }], signal, true)
    if (!bitmap) throw new Error('无法读取片段画面，请换一帧重试。')
    let parameters
    try {
      const width = Math.min(256, bitmap.width); const height = Math.max(1, Math.min(256, Math.round(bitmap.height * width / bitmap.width)))
      const canvas = new OffscreenCanvas(width, height); const context = canvas.getContext('2d')
      if (!context) throw new Error('无法分析画面颜色，请手动校色。')
      context.drawImage(bitmap, 0, 0, width, height)
      parameters = suggestLumetriAutoColor(context.getImageData(0, 0, width, height).data)
    } finally { bitmap.close() }
    signal.throwIfAborted()
    if (requireVideoEditInstance(target.projectId).document !== snapshot) throw new Error('片段已发生修改，请重新自动校色。')
    logger.info('自动校色分析完成', { event: 'video_edit.lumetri.analyze.completed', context: { projectId: target.projectId, clipId: clip.id, frame: at, durationMs: Math.round(performance.now() - started) } })
    return { parameters, frame: at, documentRevision: snapshot.revision }
  } catch (error) {
    logger.warn('自动校色分析失败', { event: 'video_edit.lumetri.analyze.failed', error, context: { projectId: target.projectId, clipId: clip.id } })
    throw error
  }
}
