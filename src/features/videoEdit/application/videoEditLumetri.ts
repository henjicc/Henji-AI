import { createLogger } from '@/core/logging'
import { videoEditComposition, type VideoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { VIDEO_EDIT_LUMETRI } from '@/core/videoEdit/lumetri'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { editVideoProject, requireVideoEditInstance, updateVideoEditGesture, type VideoEditGesture } from './videoEditService'
import { makeVideoEditBuiltinEffect, updateVideoEditBuiltinEffect, type VideoEditBuiltinEffectChanges, type VideoEditCompositeTarget } from './videoEditCompositing'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'

import { lumetriSampleFrames } from '@/core/videoEdit/lumetriMatch'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { analyzeVideoEditLumetriOffThread } from './videoEditLumetriLutClient'

export interface LumetriAnalysisOptions { sampleCount?: number; referenceClipId?: string; matchMethod?: 'moments' | 'histogram' }
export interface LumetriAnalysisResult { parameters: VideoEditBuiltinParams; frame: number; frames: number[]; documentRevision: number }

const logger = createLogger('features.videoEdit.lumetri')
function analysisClip(clip: VideoEditClip): VideoEditClip {
  const curves = { ...clip.curves }; delete curves.opacity
  return { ...clip, opacity: 1, curves, fadeInFrames: 0, fadeOutFrames: 0 }
}
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
  const created = makeVideoEditBuiltinEffect(VIDEO_EDIT_LUMETRI.id, changes.params)
  if (changes.curves) created.builtin!.curves = changes.curves
  const update = (document: typeof owner.document): typeof owner.document => ({ ...document, sequences: document.sequences.map(value => value.id === sequence.id ? { ...value, clips: value.clips.map(value => value.id === clip.id ? { ...value, effects: [...(value.effects ?? []), created] } : value) } : value) })
  if (gesture) updateVideoEditGesture(gesture, update); else editVideoProject(target.projectId, update)
}

/** Same production renderer/trial queue as preview/export; isolate the selected clip before its selected Lumetri.
 * No asset/file writes, no changes to transport. Suggestions are absolute basic-correction values. */
export async function analyzeVideoEditLumetri(target: VideoEditCompositeTarget, frame?: number, signal = new AbortController().signal, effectId?: string, options: LumetriAnalysisOptions = {}): Promise<LumetriAnalysisResult> {
  const started = performance.now(); const owner = requireVideoEditInstance(target.projectId); const snapshot = owner.document
  const sequence = snapshot.sequences.find(value => value.id === target.sequenceId); const clip = sequence?.clips.find(value => value.id === target.clipId)
  if (!sequence || !clip || clip.kind === 'audio' || clip.kind === 'adjustment') throw new Error('请选择带画面的片段，调整图层和声音片段不能自动校色。')
  const at = frame ?? (owner.frame >= clip.start && owner.frame < clip.start + clip.duration ? owner.frame : clip.start + Math.floor(clip.duration / 2))
  if (!Number.isSafeInteger(at) || at < clip.start || at >= clip.start + clip.duration) throw new Error('分析帧必须在目标片段的时间范围内。')
  const composition = videoEditComposition(snapshot, sequence.id)
  const stop = clip.effects?.findIndex(effect => effectId ? effect.id === effectId : effect.builtin?.id === 'lumetri_color') ?? -1
  if (effectId && stop < 0) throw new Error('原 Lumetri 颜色效果已移除。')
  const reference = options.referenceClipId ? sequence.clips.find(value => value.id === options.referenceClipId) : undefined
  if (options.referenceClipId && (!reference || reference.id === clip.id || reference.kind === 'audio' || reference.kind === 'adjustment')) throw new Error('参考必须是同一序列中的另一个画面片段。')
  const isolated = { ...composition, annotations: [], captions: [], transitions: [], clips: [{ ...analysisClip(clip), effects: stop < 0 ? clip.effects : clip.effects?.slice(0, stop) }], tracks: composition.tracks.map(value => ({ ...value, enabled: value.index === clip.track, solo: false })) }
  logger.info('自动校色分析开始', { event: 'video_edit.lumetri.analyze.start', context: { projectId: target.projectId, clipId: clip.id, frame: at } })
  try {
    const frames = frame === undefined ? lumetriSampleFrames(clip.start, clip.duration, options.sampleCount ?? 5) : [at]
    const sample = async (document: VideoEditComposition, times: readonly number[]): Promise<Uint8ClampedArray> => {
      const chunks: Uint8ClampedArray[] = []
      for (const time of times) {
        signal.throwIfAborted()
        const bitmap = await trialVideoEditCodeFrames([{ document, frame: time }], signal, true)
        if (!bitmap) throw new Error('无法读取片段画面，请换一帧重试。')
        try {
          signal.throwIfAborted()
          const width = Math.min(256, bitmap.width); const height = Math.max(1, Math.min(256, Math.round(bitmap.height * width / bitmap.width)))
          const canvas = new OffscreenCanvas(width, height); const context = canvas.getContext('2d')
          if (!context) throw new Error('无法分析画面颜色，请手动校色。')
          context.drawImage(bitmap, 0, 0, width, height)
          chunks.push(context.getImageData(0, 0, width, height).data)
        } finally { bitmap.close() }
        if (requireVideoEditInstance(target.projectId) !== owner || owner.document !== snapshot) throw new Error('片段已发生修改，请重新自动校色。')
      }
      const pixels = new Uint8ClampedArray(chunks.reduce((size, chunk) => size + chunk.length, 0)); let offset = 0
      for (const chunk of chunks) { pixels.set(chunk, offset); offset += chunk.length }
      return pixels
    }
    const pixels = await sample(isolated, frames)
    let parameters: VideoEditBuiltinParams
    if (reference) {
      const referenceDocument = { ...composition, annotations: [], captions: [], transitions: [], clips: [analysisClip(reference)], tracks: composition.tracks.map(track => ({ ...track, enabled: track.index === reference.track, solo: false })) }
      parameters = await analyzeVideoEditLumetriOffThread(pixels, await sample(referenceDocument, lumetriSampleFrames(reference.start, reference.duration, options.sampleCount ?? 5)), options.matchMethod, signal)
    } else parameters = await analyzeVideoEditLumetriOffThread(pixels, undefined, undefined, signal)
    signal.throwIfAborted()
    if (requireVideoEditInstance(target.projectId).document !== snapshot) throw new Error('片段已发生修改，请重新自动校色。')
    logger.info('自动校色分析完成', { event: 'video_edit.lumetri.analyze.completed', context: { projectId: target.projectId, clipId: clip.id, frame: at, durationMs: Math.round(performance.now() - started) } })
    return { parameters, frame: at, frames, documentRevision: snapshot.revision }
  } catch (error) {
    logger.warn('自动校色分析失败', { event: 'video_edit.lumetri.analyze.failed', error, context: { projectId: target.projectId, clipId: clip.id } })
    throw error
  }
}
