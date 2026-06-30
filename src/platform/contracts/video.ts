export interface VideoInfoResult {
  durationSeconds: number
  width: number
  height: number
}

export interface TrimVideoSourcePayload {
  source: string
  startSeconds: number
  endSeconds: number
}

export interface TrimVideoSourceResult {
  path: string
  durationSeconds: number
}

export interface CompressVideoToFitPayload {
  source: string
  maxSizeMB: number
}

export interface CompressVideoToFitResult {
  path: string
  sizeBytes: number
}

/**
 * 视频本地处理原生命令（ffmpeg/ffprobe）。
 */
export interface VideoPlatform {
  readVideoInfo(source: string): Promise<VideoInfoResult>
  trimVideoSource(payload: TrimVideoSourcePayload): Promise<TrimVideoSourceResult>
  compressVideoToFit(payload: CompressVideoToFitPayload): Promise<CompressVideoToFitResult>
}
