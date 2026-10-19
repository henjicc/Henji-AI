import type { SceneDetectionRequest } from '../../../../src/core/videoEdit/sceneDetection'
import type { VideoMotionScan } from '../../../../src/core/media/motionEvidence'
import { loadFfmpegPath } from './ffmpeg-loader'
import { scanVideoFrames } from './video-frame-scan'
import { readVideoAnalysisGeometry } from './ops'

/** Shared scene-analysis channel; decode is a child process and CV lives in its Worker. */
export async function analyzeVideoMotion(request: SceneDetectionRequest, signal: AbortSignal, progress: (value: number) => void, binary?: string, workerPath?: string | URL): Promise<VideoMotionScan> {
  signal.throwIfAborted()
  if (request.endSeconds - request.startSeconds > 300) throw new Error('运动分析单次最多覆盖300秒，请缩小源范围；未截断结果。')
  const executable = binary ?? await loadFfmpegPath()
  const { aspectRatio, rotation } = await readVideoAnalysisGeometry(request.source, signal)
  const longSide = Math.max(320, Math.ceil(32 * Math.max(aspectRatio, 1 / aspectRatio)))
  if (longSide > 1024) throw new Error('此视频画幅超过运动分析的32:1比例预算，请先调整画幅；未拉伸或裁掉边缘。')
  const width = aspectRatio >= 1 ? longSide : Math.max(32, Math.round(longSide * aspectRatio))
  const height = aspectRatio >= 1 ? Math.max(32, Math.round(longSide / aspectRatio)) : longSide
  return scanVideoFrames(request.source, { analysis: 'motion', width, height, sourceAspectRatio: aspectRatio, displayRotation: rotation, channels: 1, fps: 15, startSeconds: request.startSeconds, endSeconds: request.endSeconds }, executable, signal, progress, workerPath)
}
