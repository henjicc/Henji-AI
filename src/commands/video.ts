import { getPlatform } from '@/platform/runtime'
import type { VideoInfoResult, TrimVideoSourceResult, CompressVideoToFitResult } from '@/platform/contracts/video'

export async function readVideoInfo(source: string): Promise<VideoInfoResult> {
  return await getPlatform().video.readVideoInfo(source)
}

export async function trimVideoSource(
  source: string,
  startSeconds: number,
  endSeconds: number
): Promise<TrimVideoSourceResult> {
  return await getPlatform().video.trimVideoSource({ source, startSeconds, endSeconds })
}

export async function compressVideoToFit(
  source: string,
  maxSizeMB: number
): Promise<CompressVideoToFitResult> {
  return await getPlatform().video.compressVideoToFit({ source, maxSizeMB })
}
