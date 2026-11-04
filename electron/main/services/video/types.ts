export interface VideoInfoResultDto {
  durationSeconds: number
  width: number
  height: number
  hasAudio: boolean
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
  knownDurationSeconds?: number
}

export interface GenerateVideoThumbnailResultDto {
  dataUrl: string
}

export interface StartVideoFrameExportPayloadDto {
  format?: 'mp4' | 'gif'
  orientation?: 'bottom-up' | 'top-down'
  /**
   * 帧的像素格式，默认 rgba。yuv420p 是渲染层已转好的 BT.709 有限范围平面数据（Y、U、V 依次排列，
   * 自上而下），每帧 width*height*3/2 字节，只支持 mp4、宽高为偶数。
   */
  pixelFormat?: 'rgba' | 'yuv420p'
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
