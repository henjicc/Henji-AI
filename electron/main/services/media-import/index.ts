import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type {
  ImportMediaFromBytesRequest,
  ImportMediaFromPathRequest,
  LocalMediaImportResult,
  LocalMediaKind,
} from '../../../../src/core/media/localMediaImportContracts'
import { allowMediaRoot } from '../../protocol'
import { getDataRootDir, getUploadsDir } from '../image/path-utils'
import { loadSharp } from '../image/sharp-loader'
import { createMainLogger } from '../logging'
import { withMediaHeavyTask } from './concurrency'
import { detectMediaFormat, type DetectedMediaFormat } from './format'
import { probeLocalMedia, warmNativeMediaTools, writeVideoPoster } from './probe'

const logger = createMainLogger('main.media_import')
const IMPORT_TEMP_PREFIX = '.media-import-'
const STALE_TEMP_AGE_MS = 24 * 60 * 60 * 1000
const IMAGE_PREVIEW_MAX_SIZE = 512

type WarmupState = 'idle' | 'running' | 'ready' | 'failed'
let warmupPromise: Promise<void> | null = null
let warmupState: WarmupState = 'idle'

interface StoredMedia {
  fullPath: string
  sizeBytes: number
  cacheKey: string
  cacheHit: boolean
}

interface PhaseTimings {
  validationMs: number
  persistenceMs: number
  probeMs: number
  previewMs: number
}

type WarmupPhase = 'sharp' | 'native_tools' | 'temp_cleanup'

class MediaImportWarmupError extends Error {
  readonly phase: WarmupPhase

  constructor(phase: WarmupPhase, cause: unknown) {
    super(`Media import warmup failed during ${phase}`, { cause })
    this.name = 'MediaImportWarmupError'
    this.phase = phase
  }
}

async function runWarmupPhase(phase: WarmupPhase, task: () => Promise<void>): Promise<[WarmupPhase, number]> {
  const started = performance.now()
  try {
    await task()
    return [phase, roundMs(performance.now() - started)]
  } catch (error) {
    throw new MediaImportWarmupError(phase, error)
  }
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10
}

function assertImportId(value: string): void {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(value)) {
    throw new Error('Invalid media import id')
  }
}

async function readHeader(filePath: string): Promise<Uint8Array> {
  const handle = await fsp.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(64)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function validateSourcePath(
  sourcePath: string,
  expectedKind: LocalMediaKind,
): Promise<{ format: DetectedMediaFormat; sizeBytes: number; mtimeMs: number }> {
  if (!path.isAbsolute(sourcePath) || sourcePath.includes('\0')) {
    throw new Error('Media source path must be an absolute file path')
  }
  const stat = await fsp.stat(sourcePath)
  if (!stat.isFile()) {
    throw new Error('Media source must be a file')
  }
  await fsp.access(sourcePath, fs.constants.R_OK)
  const format = detectMediaFormat(await readHeader(sourcePath), sourcePath)
  if (format.kind !== expectedKind) {
    throw new Error('Media kind does not match the requested kind')
  }
  return { format, sizeBytes: stat.size, mtimeMs: stat.mtimeMs }
}

async function moveTempIntoPlace(tempPath: string, targetPath: string): Promise<boolean> {
  try {
    await fsp.access(targetPath)
    await fsp.unlink(tempPath)
    return true
  } catch {
    // Target is absent; atomically install the completed temp file.
  }
  try {
    await fsp.rename(tempPath, targetPath)
    return false
  } catch (error) {
    try {
      await fsp.access(targetPath)
      await fsp.unlink(tempPath).catch(() => undefined)
      return true
    } catch {
      throw error
    }
  }
}

async function storePathManaged(sourcePath: string, format: DetectedMediaFormat): Promise<StoredMedia> {
  const uploadsDir = getUploadsDir()
  const tempPath = path.join(uploadsDir, `${IMPORT_TEMP_PREFIX}${crypto.randomUUID()}.tmp`)
  const hash = crypto.createHash('sha256')
  let sizeBytes = 0
  const hasher = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      sizeBytes += chunk.length
      callback(null, chunk)
    },
  })
  try {
    await pipeline(fs.createReadStream(sourcePath), hasher, fs.createWriteStream(tempPath, { flags: 'wx' }))
    const digest = hash.digest('hex')
    const targetPath = path.join(uploadsDir, `${digest}.${format.extension}`)
    const cacheHit = await moveTempIntoPlace(tempPath, targetPath)
    return { fullPath: targetPath, sizeBytes, cacheKey: digest, cacheHit }
  } catch (error) {
    await fsp.unlink(tempPath).catch(() => undefined)
    throw error
  }
}

async function storeBytesManaged(bytes: Uint8Array, format: DetectedMediaFormat): Promise<StoredMedia> {
  if (bytes.byteLength === 0) throw new Error('Media bytes are empty')
  const uploadsDir = getUploadsDir()
  const digest = crypto.createHash('sha256').update(bytes).digest('hex')
  const targetPath = path.join(uploadsDir, `${digest}.${format.extension}`)
  try {
    await fsp.access(targetPath)
    return { fullPath: targetPath, sizeBytes: bytes.byteLength, cacheKey: digest, cacheHit: true }
  } catch {
    // Write the new content-addressed file below.
  }
  const tempPath = path.join(uploadsDir, `${IMPORT_TEMP_PREFIX}${crypto.randomUUID()}.tmp`)
  try {
    await fsp.writeFile(tempPath, bytes, { flag: 'wx' })
    const cacheHit = await moveTempIntoPlace(tempPath, targetPath)
    return { fullPath: targetPath, sizeBytes: bytes.byteLength, cacheKey: digest, cacheHit }
  } catch (error) {
    await fsp.unlink(tempPath).catch(() => undefined)
    throw error
  }
}

function referencedCacheKey(fullPath: string, sizeBytes: number, mtimeMs: number): string {
  return crypto.createHash('sha256').update(`${fullPath}\0${sizeBytes}\0${mtimeMs}`).digest('hex')
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.max(1, Math.round(a))
  let right = Math.max(1, Math.round(b))
  while (right !== 0) {
    const next = left % right
    left = right
    right = next
  }
  return left
}

function aspectRatio(width: number, height: number): string {
  if (!(width > 0) || !(height > 0)) return '1:1'
  const divisor = greatestCommonDivisor(width, height)
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
}

async function prepareImage(
  stored: StoredMedia,
): Promise<{ previewPath: string; aspectRatio: string; cacheHit: boolean }> {
  return await withMediaHeavyTask(async () => {
    const sharp = await loadSharp()
    const metadata = await sharp(stored.fullPath).metadata()
    const width = Math.max(1, metadata.width ?? 1)
    const height = Math.max(1, metadata.height ?? 1)
    if (Math.max(width, height) <= IMAGE_PREVIEW_MAX_SIZE) {
      return { previewPath: stored.fullPath, aspectRatio: aspectRatio(width, height), cacheHit: true }
    }
    const thumbnailsDir = path.join(getDataRootDir(), 'Thumbnails')
    await fsp.mkdir(thumbnailsDir, { recursive: true })
    const previewPath = path.join(thumbnailsDir, `image-${stored.cacheKey}.jpg`)
    try {
      await fsp.access(previewPath)
      return { previewPath, aspectRatio: aspectRatio(width, height), cacheHit: true }
    } catch {
      // Create the preview once below.
    }
    await sharp(stored.fullPath)
      .resize(IMAGE_PREVIEW_MAX_SIZE, IMAGE_PREVIEW_MAX_SIZE, { fit: 'inside' })
      .jpeg({ quality: 86 })
      .toFile(previewPath)
    return { previewPath, aspectRatio: aspectRatio(width, height), cacheHit: false }
  })
}

async function enrichResult(
  importId: string,
  format: DetectedMediaFormat,
  stored: StoredMedia,
  ownership: 'managed' | 'referenced',
  timings: PhaseTimings,
): Promise<LocalMediaImportResult> {
  if (format.kind === 'image') {
    const previewStarted = performance.now()
    const image = await prepareImage(stored)
    timings.previewMs = roundMs(performance.now() - previewStarted)
    return {
      importId,
      kind: 'image',
      fullPath: stored.fullPath,
      previewPath: image.previewPath,
      aspectRatio: image.aspectRatio,
      ownership,
      mimeType: format.mimeType,
      sizeBytes: stored.sizeBytes,
      cacheHit: stored.cacheHit && image.cacheHit,
    }
  }

  if (format.kind === 'audio') {
    const probeStarted = performance.now()
    let durationSeconds = 0
    try {
      durationSeconds = (await probeLocalMedia(stored.fullPath)).durationSeconds
    } catch (error) {
      if (format.extension !== 'pcm') throw error
    }
    timings.probeMs = roundMs(performance.now() - probeStarted)
    return {
      importId,
      kind: 'audio',
      fullPath: stored.fullPath,
      durationSeconds,
      ownership,
      mimeType: format.mimeType,
      sizeBytes: stored.sizeBytes,
      cacheHit: stored.cacheHit,
    }
  }

  const probeStarted = performance.now()
  const mediaInfo = await probeLocalMedia(stored.fullPath)
  timings.probeMs = roundMs(performance.now() - probeStarted)
  if (!(mediaInfo.width > 0) || !(mediaInfo.height > 0)) {
    throw new Error('Unable to read video dimensions')
  }
  const previewStarted = performance.now()
  const poster = await writeVideoPoster(stored.fullPath, stored.cacheKey, mediaInfo.durationSeconds)
  timings.previewMs = roundMs(performance.now() - previewStarted)
  return {
    importId,
    kind: 'video',
    fullPath: stored.fullPath,
    posterPath: poster.posterPath,
    aspectRatio: aspectRatio(mediaInfo.width, mediaInfo.height),
    durationSeconds: mediaInfo.durationSeconds,
    hasAudio: mediaInfo.hasAudio,
    ownership,
    mimeType: format.mimeType,
    sizeBytes: stored.sizeBytes,
    cacheHit: stored.cacheHit && poster.cacheHit,
  }
}

async function runImport(
  importId: string,
  expectedKind: LocalMediaKind,
  ownership: 'managed' | 'referenced',
  resolveInput: () => Promise<{
    format: DetectedMediaFormat
    stored: StoredMedia
    validationMs: number
    persistenceMs: number
  }>,
): Promise<LocalMediaImportResult> {
  assertImportId(importId)
  const started = performance.now()
  const timings: PhaseTimings = { validationMs: 0, persistenceMs: 0, probeMs: 0, previewMs: 0 }
  logger.info('媒体导入开始', {
    event: 'media_import.start',
    requestId: importId,
    context: { expectedKind, ownership, warmupState },
  })
  try {
    const { format, stored, validationMs, persistenceMs } = await resolveInput()
    timings.validationMs = validationMs
    timings.persistenceMs = persistenceMs
    const result = await enrichResult(importId, format, stored, ownership, timings)
    logger.info('媒体导入完成', {
      event: 'media_import.completed',
      requestId: importId,
      context: {
        kind: result.kind,
        sizeBytes: result.sizeBytes,
        ownership: result.ownership,
        cacheHit: result.cacheHit,
        warmupState,
        timings,
        totalMs: roundMs(performance.now() - started),
      },
    })
    return result
  } catch (error) {
    logger.error('媒体导入失败', {
      event: 'media_import.failed',
      requestId: importId,
      context: { expectedKind, ownership, warmupState, timings, totalMs: roundMs(performance.now() - started) },
      error,
    })
    throw error
  }
}

export async function importMediaFromPath(request: ImportMediaFromPathRequest): Promise<LocalMediaImportResult> {
  return await runImport(request.importId, request.expectedKind, request.ownership, async () => {
    const validationStarted = performance.now()
    const validated = await validateSourcePath(request.sourcePath, request.expectedKind)
    const validationMs = roundMs(performance.now() - validationStarted)
    const persistenceStarted = performance.now()
    const stored = request.ownership === 'referenced'
      ? {
          fullPath: request.sourcePath,
          sizeBytes: validated.sizeBytes,
          cacheKey: referencedCacheKey(request.sourcePath, validated.sizeBytes, validated.mtimeMs),
          cacheHit: true,
        }
      : await storePathManaged(request.sourcePath, validated.format)
    if (request.ownership === 'referenced') {
      allowMediaRoot(path.dirname(request.sourcePath))
    }
    return {
      format: validated.format,
      stored,
      validationMs,
      persistenceMs: roundMs(performance.now() - persistenceStarted),
    }
  })
}

export async function importMediaFromBytes(request: ImportMediaFromBytesRequest): Promise<LocalMediaImportResult> {
  return await runImport(request.importId, request.expectedKind, 'managed', async () => {
    const validationStarted = performance.now()
    const format = detectMediaFormat(request.bytes.subarray(0, 64), request.fileName)
    if (format.kind !== request.expectedKind) {
      throw new Error('Media kind does not match the requested kind')
    }
    const validationMs = roundMs(performance.now() - validationStarted)
    const persistenceStarted = performance.now()
    const stored = await storeBytesManaged(request.bytes, format)
    return {
      format,
      stored,
      validationMs,
      persistenceMs: roundMs(performance.now() - persistenceStarted),
    }
  })
}

export async function cleanupStaleMediaImportTemps(now = Date.now()): Promise<number> {
  const uploadsDir = getUploadsDir()
  const names = await fsp.readdir(uploadsDir)
  let removed = 0
  await Promise.all(names.filter((name) => name.startsWith(IMPORT_TEMP_PREFIX)).map(async (name) => {
    const fullPath = path.join(uploadsDir, name)
    try {
      const stat = await fsp.stat(fullPath)
      if (now - stat.mtimeMs > STALE_TEMP_AGE_MS) {
        await fsp.unlink(fullPath)
        removed += 1
      }
    } catch {
      // A concurrent import may already have moved or removed it.
    }
  }))
  return removed
}

export function warmupMediaImportPipeline(): Promise<void> {
  if (warmupPromise) return warmupPromise
  warmupState = 'running'
  const started = performance.now()
  warmupPromise = Promise.all([
    runWarmupPhase('sharp', async () => { await loadSharp() }),
    runWarmupPhase('native_tools', warmNativeMediaTools),
    runWarmupPhase('temp_cleanup', async () => { await cleanupStaleMediaImportTemps() }),
  ]).then((phaseResults) => {
    warmupState = 'ready'
    logger.info('媒体导入预热完成', {
      event: 'media_import.warmup.completed',
      context: {
        totalMs: roundMs(performance.now() - started),
        phases: Object.fromEntries(phaseResults),
      },
    })
  }).catch((error) => {
    warmupState = 'failed'
    warmupPromise = null
    logger.warn('媒体导入预热失败，真实导入将重试', {
      event: 'media_import.warmup.failed',
      context: {
        totalMs: roundMs(performance.now() - started),
        phase: error instanceof MediaImportWarmupError ? error.phase : 'unknown',
      },
      error,
    })
  })
  return warmupPromise
}
