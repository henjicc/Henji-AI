import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { createLogger } from '@/core/logging'
import { videoEditComposition, type VideoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { VIDEO_EDIT_COLOR_GRADE } from '@/core/videoEdit/colorGrade'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { editVideoProject, requireVideoEditInstance, updateVideoEditGesture, type VideoEditGesture } from './videoEditService'
import { makeVideoEditBuiltinEffect, updateVideoEditBuiltinEffect, type VideoEditBuiltinEffectChanges, type VideoEditCompositeTarget } from './videoEditCompositing'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { videoEditObservationVersion } from './videoEditObservationVersion'

import { colorGradeSampleFrames } from '@/core/videoEdit/colorGradeMatch'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { analyzeVideoEditColorGradeOffThread, type ColorGradeMatchMethod } from './videoEditColorLutClient'
import { computeColorStatistics, type ColorStatistics } from '@/core/imaging/adjustments/colorStatistics'

export interface ColorGradeAnalysisOptions { sampleCount?: number; referenceClipId?: string; matchMethod?: ColorGradeMatchMethod }
export interface ColorGradeAnalysisResult { parameters: VideoEditBuiltinParams; frame: number; frames: number[]; documentRevision: number; documentVersion: string }

const logger = createLogger('features.videoEdit.color_grade')
function analysisClip(clip: VideoEditClip): VideoEditClip {
  const curves = { ...clip.curves }; delete curves.opacity
  return { ...clip, opacity: 1, curves, fadeInFrames: 0, fadeOutFrames: 0 }
}
/** First edit creates the effect inside the same gesture. Cancelling also removes the newly created effect. */
export function editVideoEditColorGrade(target: VideoEditCompositeTarget, changes: Pick<VideoEditBuiltinEffectChanges, 'params' | 'curves'>, gesture?: VideoEditGesture, effectId?: string): void {
  if (gesture && gesture.projectId !== target.projectId) throw new Error('参数手势必须属于目标剪辑。')
  const owner = requireVideoEditInstance(target.projectId)
  const sequence = owner.document.sequences.find(value => value.id === target.sequenceId)
  const clip = sequence?.clips.find(value => value.id === target.clipId)
  if (!sequence || !clip) throw new Error('原片段已移除。')
  const effect = effectId ? clip.effects?.find(value => value.id === effectId) : clip.effects?.find(value => value.builtin?.id === 'color_grade')
  if (effectId && effect?.builtin?.id !== VIDEO_EDIT_COLOR_GRADE.id) throw new Error('原全能调色效果已移除，请重新选择。')
  if (effect) { updateVideoEditBuiltinEffect(target, effect.id, changes, gesture); return }
  assertVideoEditClipsEditable(sequence, [clip.id])
  if (clip.kind === 'audio') throw new Error('请选择画面片段。')
  const created = makeVideoEditBuiltinEffect(VIDEO_EDIT_COLOR_GRADE.id, changes.params)
  if (changes.curves) created.builtin!.curves = changes.curves
  const update = (document: typeof owner.document): typeof owner.document => ({ ...document, sequences: document.sequences.map(value => value.id === sequence.id ? { ...value, clips: value.clips.map(value => value.id === clip.id ? { ...value, effects: [...(value.effects ?? []), created] } : value) } : value) })
  if (gesture) updateVideoEditGesture(gesture, update); else editVideoProject(target.projectId, update)
}

/**
 * An isolated clip that does not fill the sequence frame sits on empty black. Rows and columns outside the clip's
 * content box become transparent so statistics only measure the clip (opaque black inside the box still counts).
 */
function clearEmptyBorder(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const lit = (x: number, y: number): boolean => { const i = (y * width + x) * 4; return data[i] > 2 || data[i + 1] > 2 || data[i + 2] > 2 }
  let top = 0; let bottom = height - 1; let left = 0; let right = width - 1
  const rowLit = (y: number): boolean => { for (let x = 0; x < width; x++) if (lit(x, y)) return true; return false }
  const columnLit = (x: number): boolean => { for (let y = top; y <= bottom; y++) if (lit(x, y)) return true; return false }
  while (top < bottom && !rowLit(top)) top++
  while (bottom > top && !rowLit(bottom)) bottom--
  while (left < right && !columnLit(left)) left++
  while (right > left && !columnLit(right)) right--
  const out = new Uint8ClampedArray(data)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (y < top || y > bottom || x < left || x > right) out[(y * width + x) * 4 + 3] = 0
  return out
}

/** Production renderer frames at ≤256 px, stacked vertically (same width). Throws when the edit changes mid-sample. */
async function sampleVideoEditFrames(owner: ReturnType<typeof requireVideoEditInstance>, contentVersion: number, document: VideoEditComposition, times: readonly number[], signal: AbortSignal, staleMessage = '片段已发生修改，请重新读取颜色。', cropToContent = false): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> {
  const chunks: Uint8ClampedArray[] = []; let width = 0; let height = 0
  for (const time of times) {
    signal.throwIfAborted()
    const bitmap = await trialVideoEditCodeFrames([{ document, frame: time }], signal, true)
    if (!bitmap) throw new Error('无法读取片段画面，请换一帧重试。')
    try {
      signal.throwIfAborted()
      const w = width || Math.min(256, bitmap.width); const h = Math.max(1, Math.min(256, Math.round(bitmap.height * w / bitmap.width)))
      const canvas = new OffscreenCanvas(w, h); const context = canvas.getContext('2d')
      if (!context) throw new Error('无法分析画面颜色，请手动校色。')
      context.drawImage(bitmap, 0, 0, w, h)
      const data = context.getImageData(0, 0, w, h).data
      chunks.push(cropToContent ? clearEmptyBorder(data, w, h) : data); width = w; height += h
    } finally { bitmap.close() }
    if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error(staleMessage)
  }
  const pixels = new Uint8ClampedArray(chunks.reduce((size, chunk) => size + chunk.length, 0)); let offset = 0
  for (const chunk of chunks) { pixels.set(chunk, offset); offset += chunk.length }
  return { pixels, width, height }
}

export type VideoEditColorObservationStage = 'before_grade' | 'after_grade' | 'program'
export interface VideoEditColorObservation { statistics: ColorStatistics; frame: number; frames: number[]; stage: VideoEditColorObservationStage; documentRevision: number; documentVersion: string }
/**
 * Read-only color readout (exposure, clipping, white balance, chroma, skin) and optional scope data for the same frames the
 * panel scopes show. `before_grade`/`after_grade` isolate the clip around its ColorGrade; `program` reads the composed frame.
 */
export async function observeVideoEditColor(target: Omit<VideoEditCompositeTarget, 'clipId'> & { clipId?: string }, options: { frame?: number; stage?: VideoEditColorObservationStage; sampleCount?: number; scopes?: boolean; effectId?: string } = {}, signal = new AbortController().signal): Promise<VideoEditColorObservation> {
  const owner = requireVideoEditInstance(target.projectId); const snapshot = owner.document; const contentVersion = owner.contentVersion
  const documentVersion = videoEditObservationVersion(owner, snapshot.revision)
  const sequence = snapshot.sequences.find(value => value.id === target.sequenceId)
  if (!sequence) throw new Error('原序列已移除，请重新读取剪辑。')
  const composition = videoEditComposition(snapshot, sequence.id)
  const stage = options.stage ?? (target.clipId ? 'after_grade' : 'program')
  const clip = target.clipId ? sequence.clips.find(value => value.id === target.clipId) : undefined
  if (stage !== 'program' && (!clip || clip.kind === 'audio' || clip.kind === 'adjustment')) throw new Error('调色前后读数需要一个带画面的片段；整个画面请用 program。')
  const at = options.frame ?? (clip && (owner.frame < clip.start || owner.frame >= clip.start + clip.duration) ? clip.start + Math.floor(clip.duration / 2) : owner.frame)
  if (clip && (at < clip.start || at >= clip.start + clip.duration)) throw new Error('读取帧必须在目标片段的时间范围内。')
  let document: VideoEditComposition = composition
  if (clip && stage !== 'program') {
    const index = clip.effects?.findIndex(effect => options.effectId ? effect.id === options.effectId : effect.builtin?.id === 'color_grade') ?? -1
    if (options.effectId && index < 0) throw new Error('原全能调色效果已移除。')
    const effects = index < 0 ? clip.effects : clip.effects?.slice(0, stage === 'before_grade' ? index : index + 1)
    document = { ...composition, annotations: [], captions: [], transitions: [], clips: [{ ...analysisClip(clip), effects }], tracks: composition.tracks.map(value => ({ ...value, enabled: value.index === clip.track, solo: false })) }
  }
  const frames = options.frame === undefined && clip && (options.sampleCount ?? 1) > 1 ? colorGradeSampleFrames(clip.start, clip.duration, options.sampleCount ?? 1) : [at]
  logger.info('颜色读数开始', { event: 'video_edit.color.observe.start', context: { projectId: target.projectId, clipId: clip?.id, stage, frames: frames.length } })
  try {
    const sampled = await sampleVideoEditFrames(owner, contentVersion, document, frames, signal, undefined, stage !== 'program')
    const statistics = computeColorStatistics(sampled.pixels, sampled.width, sampled.height, { scopes: options.scopes })
    logger.info('颜色读数完成', { event: 'video_edit.color.observe.completed', context: { projectId: target.projectId, stage } })
    return { statistics, frame: at, frames, stage, documentRevision: snapshot.revision, documentVersion }
  } catch (error) { logger.warn('颜色读数失败', { event: 'video_edit.color.observe.failed', error, context: { projectId: target.projectId } }); throw error }
}

/** Same production renderer/trial queue as preview/export; isolate the selected clip before its selected ColorGrade.
 * No asset/file writes, no changes to transport. Suggestions are absolute basic-correction values. */
export async function analyzeVideoEditColorGrade(target: VideoEditCompositeTarget, frame?: number, signal = new AbortController().signal, effectId?: string, options: ColorGradeAnalysisOptions = {}): Promise<ColorGradeAnalysisResult> {
  const started = performance.now(); const owner = requireVideoEditInstance(target.projectId); const snapshot = owner.document; const contentVersion = owner.contentVersion
  const documentVersion = videoEditObservationVersion(owner, snapshot.revision)
  const sequence = snapshot.sequences.find(value => value.id === target.sequenceId); const clip = sequence?.clips.find(value => value.id === target.clipId)
  if (!sequence || !clip || clip.kind === 'audio' || clip.kind === 'adjustment') throw new Error('请选择带画面的片段，调整图层和声音片段不能自动校色。')
  const at = frame ?? (owner.frame >= clip.start && owner.frame < clip.start + clip.duration ? owner.frame : clip.start + Math.floor(clip.duration / 2))
  if (!Number.isSafeInteger(at) || at < clip.start || at >= clip.start + clip.duration) throw new Error('分析帧必须在目标片段的时间范围内。')
  const composition = videoEditComposition(snapshot, sequence.id)
  const stop = clip.effects?.findIndex(effect => effectId ? effect.id === effectId : effect.builtin?.id === 'color_grade') ?? -1
  if (effectId && stop < 0) throw new Error('原全能调色效果已移除。')
  const reference = options.referenceClipId ? sequence.clips.find(value => value.id === options.referenceClipId) : undefined
  if (options.referenceClipId && (!reference || reference.id === clip.id || reference.kind === 'audio' || reference.kind === 'adjustment')) throw new Error('参考必须是同一序列中的另一个画面片段。')
  const isolated = { ...composition, annotations: [], captions: [], transitions: [], clips: [{ ...analysisClip(clip), effects: stop < 0 ? clip.effects : clip.effects?.slice(0, stop) }], tracks: composition.tracks.map(value => ({ ...value, enabled: value.index === clip.track, solo: false })) }
  logger.info('自动校色分析开始', { event: 'video_edit.color_grade.analyze.start', context: { projectId: target.projectId, clipId: clip.id, frame: at } })
  try {
    const frames = frame === undefined ? colorGradeSampleFrames(clip.start, clip.duration, options.sampleCount ?? 5) : [at]
    let sampledWidth = 0
    const sample = async (document: VideoEditComposition, times: readonly number[]): Promise<Uint8ClampedArray> => { const result = await sampleVideoEditFrames(owner, contentVersion, document, times, signal, '片段已发生修改，请重新自动校色。', true); sampledWidth ||= result.width; return result.pixels }
    const pixels = await sample(isolated, frames)
    let parameters: VideoEditBuiltinParams
    if (reference) {
      const referenceDocument = { ...composition, annotations: [], captions: [], transitions: [], clips: [analysisClip(reference)], tracks: composition.tracks.map(track => ({ ...track, enabled: track.index === reference.track, solo: false })) }
      parameters = await analyzeVideoEditColorGradeOffThread(pixels, await sample(referenceDocument, colorGradeSampleFrames(reference.start, reference.duration, options.sampleCount ?? 5)), options.matchMethod, signal)
    } else parameters = await analyzeVideoEditColorGradeOffThread(pixels, undefined, undefined, signal, sampledWidth)
    signal.throwIfAborted()
    if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('片段已发生修改，请重新自动校色。')
    logger.info('自动校色分析完成', { event: 'video_edit.color_grade.analyze.completed', context: { projectId: target.projectId, clipId: clip.id, frame: at, durationMs: Math.round(performance.now() - started) } })
    return { parameters, frame: at, frames, documentRevision: snapshot.revision, documentVersion }
  } catch (error) {
    logger.warn('自动校色分析失败', { event: 'video_edit.color_grade.analyze.failed', error, context: { projectId: target.projectId, clipId: clip.id } })
    throw error
  }
}
