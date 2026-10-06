import { createLogger } from '@/core/logging'
import { videoEditClipMedia, type VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditClipSourceRange } from '@/core/videoEdit/clipSpeed'
import { videoEditFps } from '@/core/videoEdit/time'
import { applyVideoEditSceneCuts, videoEditSceneCutFrames, type SceneEditResult } from '@/core/videoEdit/sceneEdits'
import { sceneDetectionResultSchema, sceneSensitivitySchema, type SceneApplyOptions, type SceneDetectionRequest, type SceneDetectionResult } from '@/core/videoEdit/sceneDetection'
import { getPlatform } from '@/platform/runtime'
import { editVideoProject, requireVideoEditInstance, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.scene_detection')
export interface VideoEditSceneTarget { projectId: string; sequenceId: string; clipId: string }
export interface VideoEditSceneAnalysis { analysisId: string; cutsSeconds: number[]; cutFrames: number[] }
interface Entry { target: VideoEditSceneTarget; baseline: VideoEditDocument; request: SceneDetectionRequest; result: SceneDetectionResult }
const analyses = new WeakMap<VideoEditInstance, Map<string, Entry>>()
/** Reframe reuses only current, content-validated scene results; otherwise clip boundaries suffice. */
export async function cachedVideoEditSceneCuts(target: VideoEditSceneTarget, signal?: AbortSignal): Promise<number[]> {
  const owner = requireVideoEditInstance(target.projectId)
  const sequence = owner.document.sequences.find(sequence => sequence.id === target.sequenceId)
  const clip = sequence?.clips.find(clip => clip.id === target.clipId); const media = clip && videoEditClipMedia(owner.document, clip)
  if (!sequence || !clip || !media) return []
  const range = videoEditClipSourceRange(clip, videoEditFps(sequence.frameRate))
  // Unrelated edits and a previous reframe copy do not invalidate a source-content analysis.
  const entry = [...(analyses.get(owner)?.values() ?? [])].reverse().find(entry => entry.target.sequenceId === target.sequenceId && entry.target.clipId === target.clipId && entry.request.source === media.path && range.from >= entry.request.startSeconds - 1e-7 && range.to <= entry.request.endSeconds + 1e-7)
  if (!entry) return []
  signal?.throwIfAborted()
  if (!await getPlatform().sceneDetection.validate(entry.request.source, entry.result.contentIdentity)) throw new Error('原视频已改变，请重新检测镜头后重构。')
  signal?.throwIfAborted()
  return videoEditSceneCutFrames(clip, sequence, entry.result.cutsSeconds).map(frame => frame - clip.start)
}
export async function detectVideoEditScenes(target: VideoEditSceneTarget, sensitivity = 50, signal?: AbortSignal, onProgress?: (progress: number) => void): Promise<VideoEditSceneAnalysis> {
  const owner = requireVideoEditInstance(target.projectId); const baseline = owner.document
  const sequence = baseline.sequences.find(sequence => sequence.id === target.sequenceId)
  const clip = sequence?.clips.find(clip => clip.id === target.clipId); const media = clip && videoEditClipMedia(baseline, clip)
  if (!sequence || !clip || clip.kind !== 'video' || media?.kind !== 'video') throw new Error('请选择原视频片段进行场景检测。')
  const range = videoEditClipSourceRange(clip, videoEditFps(sequence.frameRate))
  const request: SceneDetectionRequest = { requestId: crypto.randomUUID(), source: media.path, startSeconds: Math.max(0, range.from), endSeconds: Math.min(media.durationSeconds, range.to), sensitivity: sceneSensitivitySchema.parse(sensitivity) }
  const api = getPlatform().sceneDetection
  signal?.throwIfAborted()
  const unsubscribe = api.onProgress(event => { if (event.requestId === request.requestId) onProgress?.(event.progress) })
  const cancel = (): void => { void api.cancel(request.requestId).catch(error => logger.warn('取消场景检测失败', { event: 'video_edit.scene_detection.cancel_failed', error })) }
  signal?.addEventListener('abort', cancel, { once: true })
  logger.info('分析视频镜头切换', { event: 'video_edit.scene_detection.start', requestId: request.requestId })
  try {
    const result = sceneDetectionResultSchema.parse(await api.detect(request))
    signal?.throwIfAborted()
    if (requireVideoEditInstance(target.projectId) !== owner || owner.document !== baseline) throw new Error('检测期间原剪辑已改变，请重新检测。')
    let owned = analyses.get(owner); if (!owned) { owned = new Map(); analyses.set(owner, owned) }
    while (owned.size >= 16) owned.delete(owned.keys().next().value!)
    owned.set(request.requestId, { target: { ...target }, baseline, request, result })
    logger.info('视频镜头切换分析完成', { event: 'video_edit.scene_detection.completed', requestId: request.requestId, context: { cuts: result.cutsSeconds.length } })
    return { analysisId: request.requestId, cutsSeconds: [...result.cutsSeconds], cutFrames: videoEditSceneCutFrames(clip, sequence, result.cutsSeconds) }
  } catch (error) { logger.error('视频镜头分析未完成', { event: signal?.aborted ? 'video_edit.scene_detection.cancelled' : 'video_edit.scene_detection.failed', error, requestId: request.requestId }); throw error }
  finally { unsubscribe(); signal?.removeEventListener('abort', cancel) }
}
export async function applyVideoEditScenes(target: VideoEditSceneTarget, analysisId: string, options: SceneApplyOptions, signal?: AbortSignal): Promise<SceneEditResult> {
  const owner = requireVideoEditInstance(target.projectId); const entry = analyses.get(owner)?.get(analysisId)
  if (!entry || entry.target.projectId !== target.projectId || entry.target.sequenceId !== target.sequenceId || entry.target.clipId !== target.clipId) throw new Error('检测结果不属于此片段或已经释放，请重新检测。')
  if (owner.document !== entry.baseline) throw new Error('原剪辑已改变，请重新检测后应用。')
  signal?.throwIfAborted()
  logger.info('应用镜头切点', { event: 'video_edit.scene_detection.apply.start', context: { projectId: target.projectId } })
  try {
    if (!await getPlatform().sceneDetection.validate(entry.request.source, entry.result.contentIdentity)) throw new Error('原视频已改变，请重新检测。')
    signal?.throwIfAborted()
    if (requireVideoEditInstance(target.projectId) !== owner || owner.document !== entry.baseline) throw new Error('应用前原剪辑已改变，请重新检测。')
    const result = applyVideoEditSceneCuts(owner.document, target.sequenceId, target.clipId, entry.result.cutsSeconds, options)
    editVideoProject(target.projectId, () => result.document)
    analyses.get(owner)?.delete(analysisId)
    logger.info('镜头切点已应用', { event: 'video_edit.scene_detection.apply.completed', context: { cuts: result.cutFrames.length, split: options.split, markers: result.markerIds.length, subclips: result.itemIds.length } })
    return { ...result, document: owner.document }
  } catch (error) { logger.error('镜头切点未应用', { event: 'video_edit.scene_detection.apply.failed', error }); throw error }
}
