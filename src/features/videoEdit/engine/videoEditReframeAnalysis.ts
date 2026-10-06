import { generateVideoEditReframeKeyframes, videoEditReframeViewport, type VideoEditReframeSettings, type VideoEditAttentionBox } from '@/core/videoEdit/reframe'
import { videoEditClipPictureSize } from '@/core/videoEdit/clipGeometry'
import { videoEditClipMedia, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditSize } from '@/core/videoEdit/clipGeometry'
import { setVideoEditSmartRegionSegments, videoEditSmartRegionAttentionBox, type VideoEditSmartRegionSegments } from './videoEditSmartRegionMasks'
import { setVideoEditTrackResults, videoEditTrackerBox, videoEditClipSourceTimeUs, type VideoEditTrackResults } from './videoEditTrackResults'
import { videoEditTrackerKey } from '@/core/videoEdit/tracking'

export interface VideoEditReframeAnalysisRequest {
  composition: VideoEditComposition; clipId: string; target: VideoEditSize; settings: VideoEditReframeSettings
  segments: VideoEditSmartRegionSegments; tracks: VideoEditTrackResults; trackerId?: string; cuts: number[]
}
export interface VideoEditReframeAnalysisResult { clip: VideoEditClip; missingFrames: number; faceFrames: number }
/** Runs in a dedicated Worker: bounded frame/matte caches, no pixel scans on the UI thread. */
export async function analyzeVideoEditReframe(request: VideoEditReframeAnalysisRequest): Promise<VideoEditReframeAnalysisResult> {
  const clip = request.composition.clips.find(clip => clip.id === request.clipId)
  if (!clip) throw new Error('原片段不存在。')
  const media = videoEditClipMedia(request.composition, clip)
  if (!media) throw new Error('原素材不存在。')
  setVideoEditSmartRegionSegments(request.segments); setVideoEditTrackResults(request.tracks)
  const picture = videoEditClipPictureSize(request.composition, clip); const viewport = videoEditReframeViewport(picture, request.target)
  const boxes: Array<VideoEditAttentionBox | null> = []; let missingFrames = 0; let faceFrames = 0
  const tracker = clip.trackers?.find(tracker => tracker.id === request.trackerId)
  for (let frame = 0; frame < clip.duration; frame++) {
    const time = videoEditClipSourceTimeUs(request.composition, clip, clip.start + frame)
    let box: VideoEditAttentionBox | null = null
    if (request.settings.attention === 'tracker') {
      if (!tracker) throw new Error('请选择本片段的形状或物体框跟踪器。')
      const tracked = await videoEditTrackerBox(videoEditTrackerKey(media.id, tracker), time)
      if (tracked === undefined) throw new Error('跟踪结果尚未就绪，请完成跟踪后重试。')
      box = tracked ? { x: tracked[0], y: tracked[1], width: tracked[2], height: tracked[3] } : null
    } else {
      if (request.settings.attention !== 'face') box = await videoEditSmartRegionAttentionBox(media.path, 'person', time)
      if (request.settings.attention === 'face' || request.settings.attention === 'auto' && (!box || box.width > viewport.width || box.height > viewport.height)) {
        box = await videoEditSmartRegionAttentionBox(media.path, 'face', time); if (box && request.settings.attention === 'auto') faceFrames++
      }
    }
    if (!box) missingFrames++
    boxes.push(box)
  }
  return { clip: generateVideoEditReframeKeyframes(clip, boxes, picture, request.target, request.composition.fps, request.settings, request.cuts), missingFrames, faceFrames }
}
