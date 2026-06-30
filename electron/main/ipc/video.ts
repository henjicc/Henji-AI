import { compressVideoToFit, generateVideoThumbnail, readVideoInfo, trimVideoSource } from '../services/video/ops'
import type {
  CompressVideoToFitPayloadDto,
  CompressVideoToFitResultDto,
  GenerateVideoThumbnailPayloadDto,
  GenerateVideoThumbnailResultDto,
  TrimVideoSourcePayloadDto,
  TrimVideoSourceResultDto,
  VideoInfoResultDto,
} from '../services/video/types'
import { parseRecord, parseStringField, registerIpcHandler } from './registry'

export function registerVideoIpc(): void {
  registerIpcHandler<string, VideoInfoResultDto>('video:readVideoInfo', (input) => parseStringField(input, 'source'), (source) => {
    return readVideoInfo(source)
  })
  registerIpcHandler<TrimVideoSourcePayloadDto, TrimVideoSourceResultDto>('video:trimVideoSource', parseTrimPayload, (payload) => {
    return trimVideoSource(payload)
  })
  registerIpcHandler<CompressVideoToFitPayloadDto, CompressVideoToFitResultDto>('video:compressVideoToFit', parseCompressPayload, (payload) => {
    return compressVideoToFit(payload)
  })
  registerIpcHandler<GenerateVideoThumbnailPayloadDto, GenerateVideoThumbnailResultDto>(
    'video:generateThumbnail',
    parseThumbnailPayload,
    async (payload) => {
      const dataUrl = await generateVideoThumbnail(payload.source, payload.timeOffsetSeconds)
      return { dataUrl }
    }
  )
}

function parseTrimPayload(input: unknown): TrimVideoSourcePayloadDto {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    startSeconds: readNumber(record, 'startSeconds'),
    endSeconds: readNumber(record, 'endSeconds'),
  }
}

function parseCompressPayload(input: unknown): CompressVideoToFitPayloadDto {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    maxSizeMB: readNumber(record, 'maxSizeMB'),
  }
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty string field "${field}"`)
  }
  return value
}

function parseThumbnailPayload(input: unknown): GenerateVideoThumbnailPayloadDto {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    timeOffsetSeconds: readOptionalNumber(record, 'timeOffsetSeconds'),
  }
}

function readNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number field "${field}"`)
  }
  return value
}

function readOptionalNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number field "${field}"`)
  }
  return value
}
