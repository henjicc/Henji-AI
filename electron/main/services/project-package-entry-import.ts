import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import {
  IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
} from '../../../src/core/imageEdit/v3/projectPackageContracts'
import {
  validateProjectImageEditorV3EntryPath,
  type StagedProjectImageEditorV3Resource,
} from './project-package-image-editor-v3'
import {
  isSymbolicLinkEntry,
  iterateEntries,
  openEntryReadStream,
  openZip,
  readEntryBytes,
} from './zip-archive'

const PACKAGE_MEDIA_DIR = 'media/'
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024
const MAX_SINGLE_MEDIA_BYTES = 4 * 1024 * 1024 * 1024
const MAX_TOTAL_MEDIA_BYTES = 16 * 1024 * 1024 * 1024
const MAX_PROJECT_PACKAGE_ENTRIES = 100_000
const MAX_IMAGE_EDITOR_V3_ENTRIES = 50_000
const MAX_IMAGE_EDITOR_V3_TOTAL_BYTES = 32 * 1024 * 1024 * 1024
const MAX_IMAGE_EDITOR_V3_COMPRESSION_RATIO = 1_000

interface ProjectPackageMediaEntryLike {
  fileName: string
  uncompressedSize: number
}

export interface StagedProjectImageEditorV3Entries {
  manifestJson: string | null
  resources: StagedProjectImageEditorV3Resource[]
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function validatePackagePath(packagePath: string): void {
  if (!packagePath.startsWith(PACKAGE_MEDIA_DIR)) {
    throw new Error(`Invalid package media path: ${packagePath}`)
  }
  const components = packagePath.split(/[\\/]+/)
  if (components.some((component) => !component || component === '.' || component === '..')) {
    throw new Error(`Unsafe package path: ${packagePath}`)
  }
  if (components[0] !== 'media') throw new Error(`Invalid package media path: ${packagePath}`)
}

function normalizeMediaExtension(packagePath: string): string {
  const extension = path.posix.extname(packagePath).replace(/^\./, '').toLowerCase()
  return extension && extension.length <= 8 ? extension : 'bin'
}

export async function importProjectMediaEntriesAtomically<TEntry extends ProjectPackageMediaEntryLike>(
  entries: AsyncIterable<TEntry>,
  importedDir: string,
  readBytes: (entry: TEntry, entryName: string) => Promise<Buffer>,
): Promise<{ pathMap: Record<string, string>; totalBytes: number; createdPaths: string[] }> {
  const pathMap: Record<string, string> = {}
  const createdPaths: string[] = []
  let totalBytes = 0
  try {
    for await (const entry of entries) {
      const entryName = entry.fileName
      if (!entryName.startsWith(PACKAGE_MEDIA_DIR) || entryName.endsWith('/')) continue
      validatePackagePath(entryName)
      if (Object.hasOwn(pathMap, entryName)) throw new Error(`Duplicate package media entry: ${entryName}`)
      if (entry.uncompressedSize > MAX_SINGLE_MEDIA_BYTES) {
        throw new Error(`Package media too large: ${entryName}`)
      }
      totalBytes += entry.uncompressedSize
      if (totalBytes > MAX_TOTAL_MEDIA_BYTES) throw new Error('Package total media size exceeds limit')

      const bytes = await readBytes(entry, entryName)
      const digest = crypto.createHash('sha256').update(bytes).digest('hex')
      const extension = normalizeMediaExtension(entryName)
      const destPath = path.join(importedDir, `${digest.slice(0, 16)}.${extension}`)
      try {
        await fsp.writeFile(destPath, bytes, { flag: 'wx' })
        createdPaths.push(destPath)
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error
        if (await sha256File(destPath) !== digest) {
          throw new Error(`Imported media hash-prefix collision: ${entryName}`)
        }
      }
      pathMap[entryName] = destPath
    }
    return { pathMap, totalBytes, createdPaths }
  } catch (error) {
    await Promise.all(createdPaths.map((filePath) => fsp.rm(filePath, { force: true })))
    throw error
  }
}

function validateArchiveEntryName(entryName: string): void {
  if (
    !entryName
    || entryName.includes('\0')
    || entryName.includes('\\')
    || path.posix.isAbsolute(entryName)
    || /^[A-Za-z]:/.test(entryName)
  ) throw new Error(`Unsafe project package entry: ${entryName}`)
  const normalized = entryName.endsWith('/') ? entryName.slice(0, -1) : entryName
  const segments = normalized.split('/')
  if (
    segments.some((segment) => !segment || segment === '.' || segment === '..')
    || path.posix.normalize(normalized) !== normalized
  ) throw new Error(`Unsafe project package entry: ${entryName}`)
}

export async function stageProjectImageEditorV3Entries(
  archive: Awaited<ReturnType<typeof openZip>>,
  stagingDir: string,
  expected: boolean,
): Promise<StagedProjectImageEditorV3Entries> {
  const resources: StagedProjectImageEditorV3Resource[] = []
  const seen = new Set<string>()
  let manifestJson: string | null = null
  let scannedEntryCount = 0
  let imageEditEntryCount = 0
  let totalBytes = 0
  for await (const entry of iterateEntries(archive)) {
    scannedEntryCount += 1
    if (scannedEntryCount > MAX_PROJECT_PACKAGE_ENTRIES) {
      throw new Error('Project package entry count exceeds limit')
    }
    validateArchiveEntryName(entry.fileName)
    if (seen.has(entry.fileName)) throw new Error(`Duplicate project package entry: ${entry.fileName}`)
    seen.add(entry.fileName)
    if (isSymbolicLinkEntry(entry)) {
      throw new Error(`Project package entry is a symbolic link: ${entry.fileName}`)
    }
    if (!entry.fileName.startsWith('image-editor-v3/')) continue
    if (!expected) throw new Error(`Undeclared project image editor V3 entry: ${entry.fileName}`)
    imageEditEntryCount += 1
    if (imageEditEntryCount > MAX_IMAGE_EDITOR_V3_ENTRIES) {
      throw new Error('Project image editor V3 entry count exceeds limit')
    }
    validateProjectImageEditorV3EntryPath(entry.fileName)
    totalBytes += entry.uncompressedSize
    if (totalBytes > MAX_IMAGE_EDITOR_V3_TOTAL_BYTES) {
      throw new Error('Project image editor V3 expanded size exceeds limit')
    }
    const compressionRatio = entry.uncompressedSize === 0
      ? 0
      : entry.uncompressedSize / Math.max(1, entry.compressedSize)
    if (compressionRatio > MAX_IMAGE_EDITOR_V3_COMPRESSION_RATIO) {
      throw new Error(`Project image editor V3 entry has suspicious compression ratio: ${entry.fileName}`)
    }
    if (entry.fileName === IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3) {
      if (entry.uncompressedSize > MAX_MANIFEST_BYTES) {
        throw new Error('Project image editor V3 bundle manifest is too large')
      }
      manifestJson = (await readEntryBytes(archive, entry, entry.fileName)).toString('utf8')
      continue
    }
    if (entry.uncompressedSize > MAX_SINGLE_MEDIA_BYTES) {
      throw new Error(`Project image editor V3 resource is too large: ${entry.fileName}`)
    }
    const stagedPath = path.join(stagingDir, `${resources.length.toString().padStart(8, '0')}.resource`)
    const handle = await fsp.open(stagedPath, 'wx', 0o600)
    const hash = crypto.createHash('sha256')
    let byteLength = 0
    try {
      const stream = await openEntryReadStream(archive, entry, entry.fileName)
      for await (const value of stream) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
        byteLength += chunk.byteLength
        if (byteLength > entry.uncompressedSize || byteLength > MAX_SINGLE_MEDIA_BYTES) {
          throw new Error(`Project image editor V3 resource size mismatch: ${entry.fileName}`)
        }
        hash.update(chunk)
        await handle.writeFile(chunk)
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (byteLength !== entry.uncompressedSize) {
      throw new Error(`Project image editor V3 resource size mismatch: ${entry.fileName}`)
    }
    resources.push({
      path: entry.fileName,
      filePath: stagedPath,
      sha256: hash.digest('hex'),
      byteLength,
    })
  }
  if (expected && !manifestJson) throw new Error('Project image editor V3 bundle manifest missing')
  return { manifestJson, resources }
}
