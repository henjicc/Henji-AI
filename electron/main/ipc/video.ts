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
  VideoFrameExportProgressDto,
  TrimVideoSourcePayloadDto,
  TrimVideoSourceResultDto,
  VideoFrameExportResultDto,
  VideoInfoResultDto,
} from '../services/video/types'
import { parseRecord, parseStringField, registerIpcHandler } from './registry'
import { clearLegacyVideoPreviewCache } from '../services/video/preview-cache'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureAssetThumbnail } from '../services/asset-library/thumbnailService'
import { allowMediaRoot, isPathWithinAllowedMediaRoots } from '../protocol'
import { normalizeLocalSource } from '../services/image/source'
import { filmstripService } from '../services/video/filmstrip'
import { FILMSTRIP_MAX_TIME_US, isFilmstripHeight, type FilmstripHeight } from '../../../src/core/media/filmstripFrames'

const thumbnailRequests = new Map<number, Map<string, AbortController>>()

export function registerVideoIpc(): void {
  void clearLegacyVideoPreviewCache()
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
      const dataUrl = await generateVideoThumbnail(
        payload.source,
        payload.timeOffsetSeconds,
        payload.knownDurationSeconds,
      )
      return { dataUrl }
    }
  )
  registerIpcHandler<ThumbnailBytesPayload, { bytes: Uint8Array; cachePath?: string }>(
    'video:generateThumbnailBytes',
    parseThumbnailBytesPayload,
    async ({ source, maxSize, cache, frame, requestId }, event) => {
      let requests = thumbnailRequests.get(event.sender.id)
      if (!requests) {
        requests = new Map(); thumbnailRequests.set(event.sender.id, requests)
        const owned = requests
        event.sender.once('destroyed', () => {
          for (const controller of owned.values()) controller.abort(new Error('缩略图宿主已关闭。'))
          thumbnailRequests.delete(event.sender.id)
        })
      }
      if (requests.size >= 128) throw new Error('缩略图请求过多，请稍后重试。')
      if (requestId && requests.has(requestId)) throw new Error('缩略图请求标识已在使用。')
      const key = requestId ?? crypto.randomUUID()
      const controller = new AbortController(); requests.set(key, controller)
      try {
        if (frame) {
          // 片段缩略图条（任务 2.4）：按时间点与高度取一帧，结果缓存在磁盘，渲染层按路径显示。
          const cachePath = await filmstripService().frame({ source: await authorizedVideoPath(source), timeUs: frame.timeUs, height: frame.height }, controller.signal)
          allowMediaRoot(path.dirname(cachePath))
          return { bytes: new Uint8Array(), cachePath }
        }
        if (cache) {
          const filePath = normalizeLocalSource(source)
          const info = await fs.stat(filePath)
          controller.signal.throwIfAborted()
          const cachePath = await ensureAssetThumbnail(filePath, 'video', info.mtimeMs, controller.signal)
          if (!cachePath) throw new Error('未能生成视频缩略图。')
          allowMediaRoot(path.dirname(cachePath))
          return { bytes: new Uint8Array(), cachePath }
        }
        return { bytes: await generateVideoThumbnailBytes(source, maxSize, controller.signal) }
      } finally { requests.delete(key) }
    }
  )
  registerIpcHandler<string, void>('video:cancelThumbnail', input => parseStringField(input, 'requestId'), (requestId, event) => {
    thumbnailRequests.get(event.sender.id)?.get(requestId)?.abort(new Error('缩略图请求已取消。'))
  })
  registerIpcHandler<StartVideoFrameExportPayloadDto, StartVideoFrameExportResultDto>(
    'video:startFrameExport',
    parseStartFrameExportPayload,
    (payload, event) => startVideoFrameExport(payload, (sessionId, encodedFrames) => {
      if (event.sender.isDestroyed()) return
      const progress: VideoFrameExportProgressDto = {
        sessionId,
        encodedFrames,
      }
      event.sender.send('video:frameExportProgress', progress)
    })
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
    knownDurationSeconds: readOptionalNumber(record, 'knownDurationSeconds'),
  }
}

interface ThumbnailBytesPayload {
  source: string
  maxSize?: number
  cache?: boolean
  /** 片段缩略图条：素材绝对时钟上的时间点（微秒）与取帧高度档。 */
  frame?: { timeUs: number; height: FilmstripHeight }
  requestId?: string
}

async function authorizedVideoPath(source: string): Promise<string> {
  const normalized = normalizeLocalSource(source)
  if (!path.isAbsolute(normalized) || !isPathWithinAllowedMediaRoots(normalized)) throw new Error('视频素材尚未获得读取权限，请从素材库导入。')
  const canonical = await fs.realpath(normalized)
  if (!isPathWithinAllowedMediaRoots(canonical)) throw new Error('视频素材的实际路径不在已授权目录内。')
  return canonical
}

function parseThumbnailFrame(value: unknown): ThumbnailBytesPayload['frame'] {
  const record = parseRecord(value)
  const { timeUs, height } = record
  if (typeof timeUs !== 'number' || !Number.isSafeInteger(timeUs) || timeUs < 0 || timeUs > FILMSTRIP_MAX_TIME_US) throw new Error('无效的缩略帧时间。')
  if (!isFilmstripHeight(height)) throw new Error('无效的缩略帧高度。')
  if (Object.keys(record).some(key => key !== 'timeUs' && key !== 'height')) throw new Error('缩略帧请求含未知字段。')
  return { timeUs, height }
}

function parseThumbnailBytesPayload(input: unknown): ThumbnailBytesPayload {
  const record = parseRecord(input)
  if (record.cache !== undefined && typeof record.cache !== 'boolean') throw new Error('Expected boolean field "cache"')
  if (record.requestId !== undefined && (typeof record.requestId !== 'string' || !record.requestId.length || record.requestId.length > 100)) throw new Error('Expected bounded string field "requestId"')
  const maxSize = readOptionalNumber(record, 'maxSize')
  if (maxSize !== undefined && (!Number.isSafeInteger(maxSize) || maxSize < 16 || maxSize > 1024)) throw new Error('缩略图尺寸超出范围。')
  if (record.frame !== undefined && record.cache !== undefined) throw new Error('缩略帧请求不能同时指定 cache。')
  return {
    source: readString(record, 'source'),
    maxSize,
    ...(record.cache !== undefined ? { cache: record.cache } : {}),
    ...(record.frame !== undefined ? { frame: parseThumbnailFrame(record.frame) } : {}),
    ...(record.requestId !== undefined ? { requestId: record.requestId as string } : {}),
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
