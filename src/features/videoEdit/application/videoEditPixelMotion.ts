import { createLogger } from '@/core/logging'
import type { VideoEditComposition, VideoEditMedia } from '@/core/videoEdit/document'
import { VideoEditSourceMapIndex, visitVideoEditPictureInstances, type VideoEditSourceMapRange } from '@/core/videoEdit/sourceMap'
import type { VideoEditPixelMotionInput, VideoEditPixelMotionPlacement } from '@/core/videoEdit/pixelMotionReview'
import { isCodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import { VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET } from '@/core/videoEdit/motionStructure'
import { getPlatform } from '@/platform/runtime'
import { inspectVideoEditMediaContent, verifyVideoEditMediaContent } from '../videoEditMediaContent'
import { beginVideoEditContentQuery } from './videoEditContentQueryProgress'
import type { VideoEditInstance } from './videoEditService'
import { analyzeVideoEditMotionStructure } from './videoEditMotionReviewWorkerClient'

const logger = createLogger('features.videoEdit.review')
interface Plan { media: VideoEditMedia; placements: VideoEditPixelMotionPlacement[]; from: number; to: number }
export async function verifyVideoEditMotionSources(sources: readonly VideoEditMedia[], signal: AbortSignal, assertCurrent: () => void): Promise<void> {
  for (const media of sources) {
    assertCurrent()
    if (!media.assetContent?.contentIdentity) throw new Error(`素材“${media.name}”尚未绑定原文件身份，请先重新定位再审查运动。`)
    await verifyVideoEditMediaContent(media, signal); assertCurrent()
  }
}
/** Pin fresh analysis inputs only to the current read, including managed files. */
export async function pinVideoEditMotionSources(sources: readonly VideoEditMedia[], signal: AbortSignal, assertCurrent: () => void): Promise<VideoEditMedia[]> {
  const pinned: VideoEditMedia[] = []
  for (const media of sources) {
    assertCurrent()
    pinned.push(media.assetContent?.contentIdentity ? media : { ...media, assetContent: await inspectVideoEditMediaContent(media, signal) })
    assertCurrent()
  }
  await verifyVideoEditMotionSources(pinned, signal, assertCurrent)
  return pinned
}

/** Same scene-analysis channel, source cache and query progress as the content
 * index. Merge overlapping source scans while retaining each placed instance. */
export async function readVideoEditPixelMotion(owner: VideoEditInstance, composition: VideoEditComposition, range: VideoEditSourceMapRange, signal: AbortSignal, assertCurrent: () => void): Promise<{ pixels: VideoEditPixelMotionInput[]; sources: VideoEditMedia[] }> {
  assertCurrent()
  let inputItemId: string | undefined
  visitVideoEditPictureInstances(composition, range, { sequence() {}, clip(_local, entry) {
    if (Object.values(entry.path.at(-1)!.clip.code?.parameters ?? {}).some(value => isCodeImageReference(value) && value.kind !== 'image')) inputItemId ??= entry.path.at(-1)!.itemId
  } })
  let inputs: VideoEditPixelMotionPlacement[] = []
  if (inputItemId) {
    const task = beginVideoEditContentQuery(owner, inputItemId, signal, ['video_edit:read'])
    try {
      task.report({ phase: 'analyzing_video', message: '定位代码使用的画面来源' })
      const input = await analyzeVideoEditMotionStructure({ composition, range, policy: {}, planInputsOnly: true }, task.signal)
      task.signal.throwIfAborted(); assertCurrent()
      if (!input.inputPlacements) throw new Error('代码画面输入未返回映射证据，请重新查询。')
      inputs = input.inputPlacements; task.finish('completed')
    } catch (error) { task.finish('failed', error); throw error }
  }
  assertCurrent()
  const placements: VideoEditPixelMotionPlacement[] = [...new VideoEditSourceMapIndex().query(composition, range, ['video']).map(entry => ({ entry })), ...inputs]
  const groups = new Map<string, Plan[]>(), sources = new Map<string, VideoEditMedia>()
  const mediaById = new Map(composition.media.map(media => [media.id, media]))
  let frames = 0
  for (const placement of placements) {
    const { entry } = placement
    const media = entry.mediaId ? mediaById.get(entry.mediaId) : undefined
    if (!media || media.kind !== 'video') continue
    frames += entry.timeline.to - entry.timeline.from
    if (frames > VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET) throw new Error('视频运动超过60000帧实例预算，请缩小 from/to；未截断实例。')
    const key = JSON.stringify([media.assetContent?.contentIdentity ?? media.path, media.assetContent?.sizeBytes, media.assetContent?.fileModifiedAt]), group = groups.get(key) ?? []
    const from = Math.floor(entry.source.fromUs / 1e6 * 15 + 1e-8) / 15, to = Math.min(media.durationSeconds, Math.ceil(entry.source.toUs / 1e6 * 15 - 1e-8) / 15)
    if (to <= from) throw new Error('原视频运动范围无效，请核对素材时长与源入点。')
    group.push({ media, placements: [placement], from, to }); groups.set(key, group); sources.set(media.id, media)
  }
  const plans: Plan[] = []
  for (const group of groups.values()) {
    let previous: Plan | undefined
    for (const plan of group.sort((a, b) => a.from - b.from)) {
      if (previous && plan.from <= previous.to + 1e-7) { previous.to = Math.max(previous.to, plan.to); previous.placements.push(...plan.placements) }
      else { previous = plan; plans.push(plan) }
    }
  }
  if (plans.reduce((seconds, plan) => seconds + plan.to - plan.from, 0) > 300 + 1e-7) throw new Error('本次视频运动分析超过300秒不同源区间预算，请缩小 from/to；未截断证据。')
  const pixels: VideoEditPixelMotionInput[] = [], platform = getPlatform()
  const verifiedSources = await pinVideoEditMotionSources([...sources.values()], signal, assertCurrent)
  for (const plan of plans) {
    assertCurrent()
    const task = beginVideoEditContentQuery(owner, plan.placements[0].entry.path.at(-1)!.itemId, signal, ['video_edit:read']), requestId = crypto.randomUUID()
    let unsubscribe = (): void => undefined
    const cancel = (): void => { void platform.sceneDetection.cancel(requestId).catch(error => logger.warn('取消视频运动分析失败', { event: 'video_edit.review.motion.cancel_failed', error })) }
    task.signal.addEventListener('abort', cancel, { once: true })
    try {
      task.report({ phase: 'analyzing_video', message: '分析原视频运动与局部变化' })
      unsubscribe = platform.sceneDetection.onProgress(event => { if (event.requestId === requestId) task.report({ phase: 'analyzing_video', message: '分析原视频运动与局部变化', phaseProgress: event.progress }) })
      task.signal.throwIfAborted()
      const result = await platform.sceneDetection.detect({ requestId, source: plan.media.path, startSeconds: plan.from, endSeconds: plan.to, sensitivity: 50, analysis: 'motion' })
      task.signal.throwIfAborted(); assertCurrent()
      if (!result.motionScan) throw new Error('视频运动分析未返回采样证据，请重试。')
      if (result.motionScan.startSeconds !== plan.from || result.motionScan.endSeconds !== plan.to) throw new Error('视频运动证据与请求范围不符，请重新分析。')
      for (const placement of plan.placements) pixels.push({ ...placement, scan: result.motionScan })
      task.finish('completed')
    } catch (error) { task.finish('failed', error); throw error }
    finally { task.signal.removeEventListener('abort', cancel); unsubscribe() }
  }
  await verifyVideoEditMotionSources(verifiedSources, signal, assertCurrent)
  return { pixels, sources: verifiedSources }
}
