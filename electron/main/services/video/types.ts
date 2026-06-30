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
