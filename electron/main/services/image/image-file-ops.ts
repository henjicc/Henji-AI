import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { embedPanoramaMetadataInImage } from './panorama-metadata'
import {
  ensureOutputPathWithExtension,
  ensureUniquePath,
  getDataRootDir,
  getDebugDir,
  mimeFromExtension,
  normalizeExtension,
  persistImageBytes,
  persistImageBytesTracked,
  sanitizeFileStem,
  writeBytesToPath,
} from './path-utils'
import { normalizeLocalSource, resolveSourceBytes } from './source'
import type { PersistImageSourceTrackedResultDto } from './types'

export async function loadImage(filePath: string): Promise<string> {
  const localPath = normalizeLocalSource(filePath)
  const bytes = fs.readFileSync(localPath)
  return `data:${mimeFromExtension(path.extname(localPath))};base64,${bytes.toString('base64')}`
}

export async function persistImageSource(source: string): Promise<string> {
  const { bytes, extension } = await resolveSourceBytes(source)
  return persistImageBytes(bytes, extension)
}

export async function persistImageSourceTracked(
  source: string,
): Promise<PersistImageSourceTrackedResultDto> {
  const { bytes, extension } = await resolveSourceBytes(source)
  const persisted = persistImageBytesTracked(bytes, extension)
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
  const targetDir = app.getPath('downloads') || path.join(getDataRootDir(), 'Downloads')
  return await saveImageSourceToDirectory(source, targetDir, suggestedFileName)
}

export async function saveImageSourceToPath(source: string, targetPath: string): Promise<string> {
  const { bytes, extension } = await resolveSourceBytes(source)
  const outputPath = ensureOutputPathWithExtension(targetPath.trim(), extension)
  writeBytesToPath(outputPath, bytes)
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
  writeBytesToPath(outputPath, embedded.bytes)
  return outputPath
}

export async function saveImageSourceToDirectory(
  source: string,
  targetDir: string,
  suggestedFileName?: string,
): Promise<string> {
  const { bytes, extension } = await resolveSourceBytes(source)
  fs.mkdirSync(targetDir, { recursive: true })
  const stem = makeOutputStem(suggestedFileName, 'storyboard')
  const outputPath = ensureUniquePath(path.join(targetDir, `${stem}.${normalizeExtension(extension)}`))
  writeBytesToPath(outputPath, bytes)
  return outputPath
}

export async function savePanoramaImageSourceToDirectory(
  source: string,
  targetDir: string,
  suggestedFileName?: string,
): Promise<string> {
  const { bytes, extension } = await resolveSourceBytes(source)
  const embedded = await embedPanoramaMetadataInImage(bytes, extension)
  const outputExtension = embedded.format === 'jpeg' ? 'jpg' : embedded.format
  fs.mkdirSync(targetDir, { recursive: true })
  const stem = makeOutputStem(suggestedFileName, 'panorama')
  const outputPath = ensureUniquePath(path.join(targetDir, `${stem}.${normalizeExtension(outputExtension)}`))
  writeBytesToPath(outputPath, embedded.bytes)
  return outputPath
}

export async function saveImageSourceToAppDebugDir(
  source: string,
  category = 'grid',
  suggestedFileName?: string,
): Promise<string> {
  return await saveImageSourceToDirectory(source, getDebugDir(category || 'grid'), suggestedFileName)
}

function makeOutputStem(suggestedFileName: string | undefined, prefix: string): string {
  const stem = sanitizeFileStem((suggestedFileName ?? '').replace(/\.[^.]+$/, ''))
  return stem === 'storyboard-image' ? `${prefix}-${Date.now()}` : stem
}
