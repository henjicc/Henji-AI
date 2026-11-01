import type { VideoEditComposition } from '@/core/videoEdit/document'
import { evaluateVideoEditClip } from '@/core/videoEdit/keyframes'
import { VIDEO_EDIT_MOTION_BLUR_MAX_SAMPLES, VIDEO_EDIT_MOTION_BLUR_PLAYBACK_SAMPLES } from '@/core/videoEdit/motionBlur'
import type { SpatialExposurePlan, SpatialFrameRequest } from './videoEditSpatialContracts'
import { planSpatialExposure, type SpatialCompositionAt } from './videoEditSpatialExposurePlan'
import { applyVideoEditClipFollow, applyVideoEditStabilization } from './videoEditTrackResults'

/** 异步跟踪读取在曝光前完成；同步几何规划与作者观测共享同一批修正后的姿态。 */
export async function prepareVideoEditSpatialGeometry(request: SpatialFrameRequest, source: VideoEditComposition): Promise<{ plan: SpatialExposurePlan; compositionAt?: SpatialCompositionAt }> {
  const initial = planSpatialExposure(request)
  if (!request.composition.clips.some(clip => clip.follow || clip.stabilization)) return { plan: initial }
  const [start, end] = initial.shotRange
  const times = new Set([request.sequenceFrame])
  for (let index = 0; index <= 8; index++) times.add(start + (end - start) * index / 8)
  // 修正后的位移决定样本数，准备全部合法网格避免第二次规划临时读取跟踪数据。
  const maximum = request.quality === 'interactive' ? VIDEO_EDIT_MOTION_BLUR_PLAYBACK_SAMPLES : VIDEO_EDIT_MOTION_BLUR_MAX_SAMPLES
  for (let count = 2; count <= maximum; count++) for (let index = 0; index < count; index++) times.add(start + (index + .5) / count * (end - start))
  const frames = new Map<number, VideoEditComposition>()
  for (const time of times) {
    request.signal.throwIfAborted(); request.assertCurrent()
    const followed = await applyVideoEditClipFollow(source, [...request.composition.clips], time)
    const clips = await applyVideoEditStabilization(source, followed.map(clip => evaluateVideoEditClip(clip, time)), time)
    frames.set(time, { ...request.composition, clips: clips.map(clip => ({ ...clip, curves: undefined })) })
  }
  const compositionAt: SpatialCompositionAt = time => {
    const frame = frames.get(time)
    if (!frame) throw new Error(`空间曝光时刻 ${time} 未准备跟踪姿态。`)
    return frame
  }
  request.signal.throwIfAborted(); request.assertCurrent()
  return { plan: planSpatialExposure(request, undefined, compositionAt), compositionAt }
}
