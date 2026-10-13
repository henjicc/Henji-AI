import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import type {
  AppendVideoFrameExportPayload,
  CompressVideoToFitResult,
  FinishVideoFrameExportPayload,
  StartVideoFrameExportPayload,
  StartVideoFrameExportResult,
  TrimVideoSourceResult,
  VideoFrameExportResult,
  VideoFrameExportProgress,
  VideoInfoResult,
} from '@/platform/contracts/video'

export async function readVideoInfo(source: string): Promise<VideoInfoResult> {
  return await getPlatform().video.readVideoInfo(source)
}

export async function trimVideoSource(
  source: string,
  startSeconds: number,
  endSeconds: number,
  signal?: AbortSignal,
): Promise<TrimVideoSourceResult> {
  return await processVideo(() => getPlatform().video.trimVideoSource({ source, startSeconds, endSeconds }, signal))
}

export async function compressVideoToFit(
  source: string,
  maxSizeMB: number,
  signal?: AbortSignal,
): Promise<CompressVideoToFitResult> {
  return await processVideo(() => getPlatform().video.compressVideoToFit({ source, maxSizeMB }, signal))
}

async function processVideo<T>(task: () => Promise<T>): Promise<T> {
  try { return await task() } catch (error) {
    createLogger('commands.video').warn('视频处理未完成', { event: 'video.processing.failed', error })
    throw error
  }
}

export async function startVideoFrameExport(
  payload: StartVideoFrameExportPayload,
): Promise<StartVideoFrameExportResult> {
  return await getPlatform().video.startFrameExport(payload)
}

export async function appendVideoFrameExport(
  payload: AppendVideoFrameExportPayload,
): Promise<{ frameIndex: number }> {
  return await getPlatform().video.appendFrameExport(payload)
}

export async function finishVideoFrameExport(
  payload: FinishVideoFrameExportPayload,
): Promise<VideoFrameExportResult> {
  return await getPlatform().video.finishFrameExport(payload)
}

export async function cancelVideoFrameExport(sessionId: string): Promise<void> {
  await getPlatform().video.cancelFrameExport(sessionId)
}

export function onVideoFrameExportProgress(
  listener: (progress: VideoFrameExportProgress) => void,
): () => void {
  return getPlatform().video.onFrameExportProgress(listener)
}
