import {
  appendVideoFrameExport,
  cancelVideoFrameExport,
  finishVideoFrameExport,
  startVideoFrameExport,
} from '../services/video/frame-export'
import { compressVideoToFit, generateVideoThumbnail, generateVideoThumbnailBytes, readVideoInfo, trimVideoSource } from '../services/video/ops'
import type {
  AppendVideoFrameExportPayloadDto,
  CompressVideoToFitPayloadDto,
  CompressVideoToFitResultDto,
  FinishVideoFrameExportPayloadDto,
  GenerateVideoThumbnailPayloadDto,
  GenerateVideoThumbnailResultDto,
  StartVideoFrameExportPayloadDto,
  StartVideoFrameExportResultDto,
  TrimVideoSourcePayloadDto,
  TrimVideoSourceResultDto,
  VideoFrameExportResultDto,
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
  registerIpcHandler<ThumbnailBytesPayload, { bytes: Uint8Array }>(
    'video:generateThumbnailBytes',
    parseThumbnailBytesPayload,
    async ({ source, maxSize }) => {
      const bytes = await generateVideoThumbnailBytes(source, maxSize)
      return { bytes }
    }
  )
  registerIpcHandler<StartVideoFrameExportPayloadDto, StartVideoFrameExportResultDto>(
    'video:startFrameExport',
    parseStartFrameExportPayload,
    (payload) => startVideoFrameExport(payload)
  )
  registerIpcHandler<AppendVideoFrameExportPayloadDto, { frameIndex: number }>(
    'video:appendFrameExport',
    parseAppendFrameExportPayload,
    (payload) => appendVideoFrameExport(payload)
  )
  registerIpcHandler<FinishVideoFrameExportPayloadDto, VideoFrameExportResultDto>(
    'video:finishFrameExport',
    parseFinishFrameExportPayload,
    (payload) => finishVideoFrameExport(payload)
  )
  registerIpcHandler<string, void>(
    'video:cancelFrameExport',
    (input) => parseStringField(input, 'sessionId'),
    (sessionId) => cancelVideoFrameExport(sessionId)
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

interface ThumbnailBytesPayload {
  source: string
  maxSize?: number
}

function parseThumbnailBytesPayload(input: unknown): ThumbnailBytesPayload {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    maxSize: readOptionalNumber(record, 'maxSize'),
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

function parseStartFrameExportPayload(input: unknown): StartVideoFrameExportPayloadDto {
  const record = parseRecord(input)
  return {
    frameCount: readPositiveInteger(record, 'frameCount'),
    fps: readBoundedNumber(record, 'fps', 1, 120),
    width: readPositiveInteger(record, 'width'),
    height: readPositiveInteger(record, 'height'),
    fileNameStem: readString(record, 'fileNameStem'),
  }
}

function parseAppendFrameExportPayload(input: unknown): AppendVideoFrameExportPayloadDto {
  const record = parseRecord(input)
  return {
    sessionId: readString(record, 'sessionId'),
    frameIndex: readInteger(record, 'frameIndex'),
    bytes: readNonEmptyUint8Array(record, 'bytes'),
  }
}

function parseFinishFrameExportPayload(input: unknown): FinishVideoFrameExportPayloadDto {
  const record = parseRecord(input)
  const targetPath = record.targetPath
  if (targetPath !== undefined && typeof targetPath !== 'string') {
    throw new Error('Expected string field "targetPath"')
  }
  return {
    sessionId: readString(record, 'sessionId'),
    targetPath,
  }
}

function readInteger(record: Record<string, unknown>, field: string): number {
  const value = readNumber(record, field)
  if (!Number.isInteger(value)) throw new Error(`Expected integer field "${field}"`)
  return value
}

function readPositiveInteger(record: Record<string, unknown>, field: string): number {
  const value = readInteger(record, field)
  if (value <= 0) throw new Error(`Expected positive integer field "${field}"`)
  return value
}

function readNonEmptyUint8Array(record: Record<string, unknown>, field: string): Uint8Array {
  const value = record[field]
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(`Expected non-empty Uint8Array field "${field}"`)
  }
  return value
}

function readBoundedNumber(
  record: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number {
  const value = readNumber(record, field)
  if (value < min || value > max) {
    throw new Error(`Expected field "${field}" to be between ${min} and ${max}`)
  }
  return value
}
