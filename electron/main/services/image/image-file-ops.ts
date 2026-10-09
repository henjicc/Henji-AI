import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { embedPanoramaMetadataInImage } from './panorama-metadata'
import {
  ensureOutputPathWithExtension,
  ensureUniquePath,
  encodeImageBase64,
  getDebugDir,
  mimeFromExtension,
  normalizeExtension,
  persistImageBytes,
  persistImageBytesTracked,
  sanitizeFileStem,
  writeBytesToPath,
  writeReservedImage,
} from './path-utils'
import { getProgramStoreDir } from '../appPaths'
import { createMainLogger } from '../logging'
import { normalizeLocalSource, resolveSourceBytes } from './source'
import type { PersistImageSourceTrackedResultDto } from './types'

const logger = createMainLogger('main.image.files')

export async function loadImage(filePath: string): Promise<string> {
  const localPath = normalizeLocalSource(filePath)
  logger.debug('图片读取开始', { event: 'image.file.read.start' })
  try {
    const bytes = await fs.promises.readFile(localPath)
    const result = `data:${mimeFromExtension(path.extname(localPath))};base64,${await encodeImageBase64(bytes)}`
    logger.debug('图片读取完成', { event: 'image.file.read.completed', context: { byteLength: bytes.length } })
    return result
  } catch (error) {
    logger.error('图片读取失败', { event: 'image.file.read.failed', error })
    throw error
  }
}

export async function persistImageSource(source: string): Promise<string> {
  const { bytes, extension } = await resolveSourceBytes(source)
  return persistImageBytes(bytes, extension)
}

export async function persistImageSourceTracked(
  source: string,
): Promise<PersistImageSourceTrackedResultDto> {
  const { bytes, extension } = await resolveSourceBytes(source)
  const persisted = await persistImageBytesTracked(bytes, extension)
  return {
    imagePath: persisted.filePath,
    createdFilePaths: persisted.created ? [persisted.filePath] : [],
  }
}

export async function persistImageBinary(bytes: Uint8Array, extension = 'png'): Promise<string> {
  return persistImageBytes(Buffer.from(bytes), extension)
}

export async function saveImageSourceToDownloads(
  source: string,
  suggestedFileName?: string,
): Promise<string> {
  const targetDir = app.getPath('downloads') || getProgramStoreDir('downloads')
  return await saveImageSourceToDirectory(source, targetDir, suggestedFileName)
}

export async function saveImageSourceToPath(source: string, targetPath: string): Promise<string> {
  const { bytes, extension } = await resolveSourceBytes(source)
  const outputPath = ensureOutputPathWithExtension(targetPath.trim(), extension)
  await writeBytesToPath(outputPath, bytes)
  return outputPath
}

export async function savePanoramaImageSourceToPath(
  source: string,
  targetPath: string,
): Promise<string> {
  const { bytes, extension } = await resolveSourceBytes(source)
  const embedded = await embedPanoramaMetadataInImage(bytes, extension)
  const outputExtension = embedded.format === 'jpeg' ? 'jpg' : embedded.format
  const parsed = path.parse(targetPath.trim())
  const outputPath = path.join(parsed.dir, `${parsed.name}.${normalizeExtension(outputExtension)}`)
  await writeBytesToPath(outputPath, embedded.bytes)
  return outputPath
}

export async function saveImageSourceToDirectory(
  source: string,
  targetDir: string,
  suggestedFileName?: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  const { bytes, extension } = await resolveSourceBytes(source)
  const stem = makeOutputStem(suggestedFileName, 'storyboard')
  const reservation = await ensureUniquePath(path.join(targetDir, `${stem}.${normalizeExtension(extension)}`), signal)
  return writeReservedImage(reservation, bytes, signal)
}

export async function savePanoramaImageSourceToDirectory(
  source: string,
  targetDir: string,
  suggestedFileName?: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  const { bytes, extension } = await resolveSourceBytes(source)
  const embedded = await embedPanoramaMetadataInImage(bytes, extension)
  const outputExtension = embedded.format === 'jpeg' ? 'jpg' : embedded.format
  const stem = makeOutputStem(suggestedFileName, 'panorama')
  const reservation = await ensureUniquePath(path.join(targetDir, `${stem}.${normalizeExtension(outputExtension)}`), signal)
  return writeReservedImage(reservation, embedded.bytes, signal)
}

export async function saveImageSourceToAppDebugDir(
  source: string,
  category = 'grid',
  suggestedFileName?: string,
): Promise<string> {
  return await saveImageSourceToDirectory(source, await getDebugDir(category || 'grid'), suggestedFileName)
}

function makeOutputStem(suggestedFileName: string | undefined, prefix: string): string {
  const stem = sanitizeFileStem((suggestedFileName ?? '').replace(/\.[^.]+$/, ''))
  return stem === 'storyboard-image' ? `${prefix}-${Date.now()}` : stem
}
