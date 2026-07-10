export interface VideoInfoResultDto {
  durationSeconds: number
  width: number
  height: number
}

export interface TrimVideoSourcePayloadDto {
  source: string
  startSeconds: number
  endSeconds: number
}

export interface TrimVideoSourceResultDto {
  path: string
  durationSeconds: number
}

export interface CompressVideoToFitPayloadDto {
  source: string
  maxSizeMB: number
}

export interface CompressVideoToFitResultDto {
  path: string
  sizeBytes: number
}

export interface GenerateVideoThumbnailPayloadDto {
  source: string
  timeOffsetSeconds?: number
}

export interface GenerateVideoThumbnailResultDto {
  dataUrl: string
}

export interface StartVideoFrameExportPayloadDto {
  frameCount: number
  fps: number
  width: number
  height: number
  fileNameStem: string
}

export interface StartVideoFrameExportResultDto {
  sessionId: string
}

export interface AppendVideoFrameExportPayloadDto {
  sessionId: string
  frameIndex: number
  bytes: Uint8Array
}

export interface FinishVideoFrameExportPayloadDto {
  sessionId: string
  targetPath?: string
}

export interface VideoFrameExportProgressDto {
  sessionId: string
  encodedFrames: number
}

export interface VideoFrameExportResultDto {
  mediaPath: string
  savedPath: string
  durationSeconds: number
  frameCount: number
  width: number
  height: number
}
