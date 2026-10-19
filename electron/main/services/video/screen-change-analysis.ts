import { planScreenChangeRefinement, type ScreenChangeScan } from '../../../../src/core/videoEdit/screenChanges'
import { validateScreenChangeAnalysis, type ScreenChangeAnalysis } from '../../../../src/core/media/screenChangeEvidence'
import type { SceneDetectionRequest } from '../../../../src/core/videoEdit/sceneDetection'
import { loadFfmpegPath } from './ffmpeg-loader'
import { scanVideoFrames } from './video-frame-scan'

async function scanSource(source: string, fromSeconds: number, toSeconds: number, fps: number, executable: string, signal: AbortSignal,
  progress: (value: number) => void, workerPath?: string | URL): Promise<ScreenChangeScan> {
  return scanVideoFrames(source, { width: 480, height: 270, channels: 3, fps, startSeconds: fromSeconds, endSeconds: toSeconds }, executable, signal, progress, workerPath)
}

/** FFmpeg owns decode, the Worker owns pixels, and backpressure bounds bytes in flight. */
export async function analyzeScreenChanges(request: SceneDetectionRequest, signal: AbortSignal, progress: (value: number) => void,
  binary?: string, workerPath?: string | URL): Promise<ScreenChangeAnalysis> {
  signal.throwIfAborted()
  const executable = binary ?? await loadFfmpegPath()
  const coarse = await scanSource(request.source, request.startSeconds, request.endSeconds, 5, executable, signal, value => progress(value * .7), workerPath)
  const plan = planScreenChangeRefinement(coarse.candidates, request.startSeconds, request.endSeconds)
  const refinements: ScreenChangeAnalysis['refinements'] = []
  const totalSeconds = plan.ranges.reduce((total, range) => total + range.toSeconds - range.fromSeconds, 0)
  let completedSeconds = 0
  for (const range of plan.ranges) {
    const duration = range.toSeconds - range.fromSeconds
    const scan = await scanSource(request.source, range.fromSeconds, range.toSeconds, 30, executable, signal,
      value => progress(.7 + .29 * (completedSeconds + duration * value) / totalSeconds), workerPath)
    refinements.push({ ...range, scan }); completedSeconds += duration
  }
  const result = { coarse, refinements, omittedCandidates: plan.omitted }
  validateScreenChangeAnalysis(result, request.startSeconds, request.endSeconds)
  signal.throwIfAborted(); progress(1); return result
}
