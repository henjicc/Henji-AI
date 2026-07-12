export interface VideoInfoResult {
  durationSeconds: number
  width: number
  height: number
  hasAudio: boolean
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

export interface StartVideoFrameExportPayload {
  frameCount: number
  fps: number
  width: number
  height: number
  fileNameStem: string
}

export interface StartVideoFrameExportResult {
  sessionId: string
}

export interface AppendVideoFrameExportPayload {
  sessionId: string
  frameIndex: number
  bytes: Uint8Array
}

export interface FinishVideoFrameExportPayload {
  sessionId: string
  targetPath?: string
}

export interface VideoFrameExportResult {
  mediaPath: string
  savedPath: string
  durationSeconds: number
  frameCount: number
  width: number
  height: number
}

export interface VideoFrameExportProgress {
  sessionId: string
  encodedFrames: number
}

/**
 * 视频本地处理原生命令（ffmpeg/ffprobe）。
 */
export interface VideoPlatform {
  readVideoInfo(source: string): Promise<VideoInfoResult>
  trimVideoSource(payload: TrimVideoSourcePayload): Promise<TrimVideoSourceResult>
  compressVideoToFit(payload: CompressVideoToFitPayload): Promise<CompressVideoToFitResult>
  startFrameExport(payload: StartVideoFrameExportPayload): Promise<StartVideoFrameExportResult>
  appendFrameExport(payload: AppendVideoFrameExportPayload): Promise<{ frameIndex: number }>
  finishFrameExport(payload: FinishVideoFrameExportPayload): Promise<VideoFrameExportResult>
  cancelFrameExport(sessionId: string): Promise<void>
  onFrameExportProgress(listener: (progress: VideoFrameExportProgress) => void): () => void
}
