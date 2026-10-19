import type { SceneDetectionRequest } from '../../../../src/core/videoEdit/sceneDetection'
import type { VideoMotionScan } from '../../../../src/core/media/motionEvidence'
import { loadFfmpegPath } from './ffmpeg-loader'
import { scanVideoFrames } from './video-frame-scan'

/** Shared scene-analysis channel; decode is a child process and CV lives in its Worker. */
export async function analyzeVideoMotion(request: SceneDetectionRequest, signal: AbortSignal, progress: (value: number) => void, binary?: string, workerPath?: string | URL): Promise<VideoMotionScan> {
  signal.throwIfAborted()
  if (request.endSeconds - request.startSeconds > 300) throw new Error('运动分析单次最多覆盖300秒，请缩小源范围；未截断结果。')
  const executable = binary ?? await loadFfmpegPath()
  return scanVideoFrames(request.source, { analysis: 'motion', width: 320, height: 180, channels: 1, fps: 15, startSeconds: request.startSeconds, endSeconds: request.endSeconds }, executable, signal, progress, workerPath)
}
