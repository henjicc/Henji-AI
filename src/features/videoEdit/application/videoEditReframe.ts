import { createLogger } from '@/core/logging'
import { copyVideoEditSequence } from '@/core/videoEdit/sequenceCopy'
import { videoEditClipMedia, videoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { videoEditReframeSettingsSchema, videoEditReframeSizeSchema, type VideoEditReframeSettings } from '@/core/videoEdit/reframe'
import type { VideoEditSize } from '@/core/videoEdit/clipGeometry'
import { getPlatform } from '@/platform/runtime'
import { smartRegionRequestKey, type SmartRegionRequest, type SmartRegionSegmentRef, type SmartRegionStatus } from '@/platform/contracts/smartRegions'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { videoEditSmartRegionRequest, videoEditSmartRegionFailureText } from './videoEditSmartRegions'
import { videoEditTrackingRequest } from './videoEditTracking'
import { videoEditTrackerKey } from '@/core/videoEdit/tracking'
import { cachedVideoEditSceneCuts } from './videoEditSceneDetection'
import { analyzeVideoEditReframeOffThread } from './videoEditReframeWorkerClient'
import { editVideoProject, holdVideoEditActivity, requireVideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.reframe')
export interface VideoEditReframeTarget { projectId: string; sequenceId: string; clipId?: string }
export interface VideoEditReframeOptions { size?: VideoEditSize; name?: string; settings: VideoEditReframeSettings; trackers?: Record<string, string> }
export interface VideoEditReframeResult { sequenceId: string; clipIds: string[]; missingFrames: number; faceFrames: number; created: boolean }

/** Stop waiting on cancel; shared cached analysis may also be needed by another effect/clip. */
function ensureRegion(request: SmartRegionRequest, signal: AbortSignal): Promise<SmartRegionSegmentRef> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    let settled = false; let unsubscribe = (): void => undefined
    const finish = (status?: SmartRegionStatus, error?: unknown): void => {
      if (settled || !error && status?.state === 'analyzing') return
      settled = true; unsubscribe(); signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else if (status?.state === 'ready') resolve(status.segment)
      else reject(new Error(videoEditSmartRegionFailureText(status?.state === 'failed' ? status.reason : 'inference')))
    }
    const abort = (): void => finish(undefined, signal.reason ?? new Error('自动重构已取消。'))
    try {
      unsubscribe = getPlatform().smartRegions.onProgress(event => { if (smartRegionRequestKey(event.request) === smartRegionRequestKey(request)) finish(event.status) })
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      void getPlatform().smartRegions.ensure(request).then(status => finish(status), error => finish(undefined, error))
    } catch (error) { finish(undefined, error) }
  })
}
/** Local analysis + keyframe generation + optional sequence copy commit as one undoable document edit. */
export async function reframeVideoEdit(target: VideoEditReframeTarget, options: VideoEditReframeOptions, signal?: AbortSignal, onProgress?: (progress: number) => void): Promise<VideoEditReframeResult> {
  const settings = videoEditReframeSettingsSchema.parse(options.settings)
  const owner = requireVideoEditInstance(target.projectId); const baseline = owner.document
  const sequence = baseline.sequences.find(sequence => sequence.id === target.sequenceId)
  if (!sequence) throw new Error('原序列不存在，请重新选择。')
  if (!target.clipId && baseline.sequences.length >= 32) throw new Error('剪辑最多保留 32 个序列，请先移除空序列。')
  const size = videoEditReframeSizeSchema.parse(target.clipId ? { width: sequence.width, height: sequence.height } : options.size)
  if (sequence.pixelAspectRatio.numerator !== sequence.pixelAspectRatio.denominator) throw new Error('自动重构暂只支持方形像素序列，请先调整序列像素长宽比。')
  const clips = sequence.clips.filter(clip => (!target.clipId || clip.id === target.clipId) && clip.kind === 'video' && clip.sourceComponent !== 'audio')
  if (!clips.length) throw new Error('请选择包含原视频片段的序列或单个视频片段。')
  if (target.clipId && sequence.tracks.find(track => track.index === clips[0].track)?.locked) throw new Error('目标轨道已锁定，请先解锁。')
  const operationSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000)
  const release = holdVideoEditActivity(target.projectId, '自动重构画幅')
  const current = (): void => { operationSignal.throwIfAborted(); if (requireVideoEditInstance(target.projectId) !== owner || owner.document !== baseline) throw new Error('分析期间原剪辑已改变，请重新生成。') }
  const updated = new Map<string, VideoEditClip>(); let missingFrames = 0; let faceFrames = 0
  logger.info('开始自动重构画幅', { event: 'video_edit.reframe.start', context: { projectId: target.projectId, sequenceId: target.sequenceId, clips: clips.length } })
  try {
    for (const [index, clip] of clips.entries()) {
      current()
      const media = videoEditClipMedia(baseline, clip)
      if (media?.kind !== 'video') throw new Error(`片段“${clip.name}”没有可分析的原视频。`)
      const segments: Record<string, Partial<Record<'face' | 'person', Array<{ url: string; startUs: number; endUs: number; still: boolean }>>>> = {}
      const tracks: Record<string, { url: string; version: string }> = {}
      const trackerId = options.trackers?.[clip.id]
      if (settings.attention === 'tracker') {
        const tracker = clip.trackers?.find(tracker => tracker.id === trackerId)
        if (!tracker || !['shape', 'box'].includes(tracker.method)) throw new Error(`请为片段“${clip.name}”选择已完成的形状或物体框跟踪器。`)
        const request = videoEditTrackingRequest(baseline, sequence.frameRate, clip, tracker)!
        const status = await getPlatform().tracking.status(request.definition)
        if (status.state !== 'ready' || status.result.startUs > request.range.startUs || status.result.endUs < request.range.endUs) throw new Error(`片段“${clip.name}”的跟踪尚未覆盖完整片段，请完成跟踪后重试。`)
        tracks[videoEditTrackerKey(media.id, tracker)] = { url: toFetchableMediaUrl(status.result.path), version: status.result.path }
      } else {
        for (const kind of (settings.attention === 'auto' ? ['person', 'face'] : [settings.attention]) as Array<'person' | 'face'>) {
          const request = videoEditSmartRegionRequest(baseline, sequence.frameRate, clip, { mask: { regionId: kind } })!
          const result = await ensureRegion(request, operationSignal)
          ;(segments[toFetchableMediaUrl(media.path)] ??= {})[kind] = [{ url: toFetchableMediaUrl(result.path), startUs: result.startUs, endUs: result.endUs, still: result.still }]
        }
      }
      current()
      const composition = videoEditComposition(baseline, sequence.id)
      // Only target clip is needed for source-clock mapping and analysis; media/items remain shared metadata.
      composition.clips = [clip]
      composition.media = composition.media.map(media => ({ ...media, path: toFetchableMediaUrl(media.path) }))
      const result = await analyzeVideoEditReframeOffThread({ composition, clipId: clip.id, target: size, settings, segments, tracks, trackerId, cuts: await cachedVideoEditSceneCuts({ ...target, clipId: clip.id }, operationSignal) }, operationSignal)
      updated.set(clip.id, result.clip); missingFrames += result.missingFrames; faceFrames += result.faceFrames
      onProgress?.((index + 1) / clips.length)
    }
    current()
    const reframed = { ...sequence, ...size, clips: sequence.clips.map(clip => updated.get(clip.id) ?? clip) }
    const result = target.clipId ? reframed : copyVideoEditSequence(reframed)
    if (!target.clipId) result.name = options.name?.trim() || `${sequence.name.slice(0, 160)} · ${size.width}×${size.height}`
    editVideoProject(target.projectId, document => ({ ...document, sequences: target.clipId ? document.sequences.map(sequence => sequence.id === target.sequenceId ? result : sequence) : [...document.sequences, result] }))
    logger.info('自动重构画幅完成', { event: 'video_edit.reframe.completed', context: { projectId: target.projectId, clips: clips.length, missingFrames, faceFrames } })
    return { sequenceId: result.id, clipIds: result.clips.filter(clip => clip.kind === 'video' && clip.sourceComponent !== 'audio' && (!target.clipId || clip.id === target.clipId)).map(clip => clip.id), missingFrames, faceFrames, created: !target.clipId }
  } catch (error) { logger.error('自动重构画幅未完成', { event: operationSignal.aborted ? 'video_edit.reframe.cancelled' : 'video_edit.reframe.failed', error, context: { projectId: target.projectId } }); throw error }
  finally { release() }
}
