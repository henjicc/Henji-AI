import { ZipArchive } from 'archiver'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import * as yauzl from 'yauzl'
import { getDataRootDir } from './image/path-utils'

const PACKAGE_MANIFEST_NAME = 'manifest.json'
const PACKAGE_MEDIA_DIR = 'media/'
const SUPPORTED_FORMAT_VERSION = 1
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024
const MAX_SINGLE_MEDIA_BYTES = 4 * 1024 * 1024 * 1024
const MAX_TOTAL_MEDIA_BYTES = 16 * 1024 * 1024 * 1024

export interface PackageMediaFileDto {
  srcPath: string
  packagePath: string
}

export interface ImportedProjectPackageDto {
  manifestJson: string
  pathMap: Record<string, string>
}

export async function exportProjectPackage(
  manifestJson: string,
  mediaFiles: PackageMediaFileDto[],
  targetPath: string
): Promise<void> {
  const target = targetPath.trim()
  if (!target) {
    throw new Error('Export target path is empty')
  }

  await fsp.mkdir(path.dirname(target), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(target)
    const archive = new ZipArchive({ zlib: { level: 9 } })
    const writtenPaths = new Set<string>()

    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    archive.append(manifestJson, { name: PACKAGE_MANIFEST_NAME })

    for (const media of mediaFiles) {
      validatePackagePath(media.packagePath)
      if (writtenPaths.has(media.packagePath)) {
        continue
      }
      archive.file(media.srcPath, { name: media.packagePath })
      writtenPaths.add(media.packagePath)
    }

    archive.finalize().catch(reject)
  })
}

export async function importProjectPackage(zipPath: string): Promise<ImportedProjectPackageDto> {
  const source = zipPath.trim()
  if (!source) {
    throw new Error('Package path is empty')
  }

  const manifestJson = await readManifest(source)
  validateManifestVersion(manifestJson)

  const importedDir = path.join(getDataRootDir(), 'Uploads', 'imported')
  await fsp.mkdir(importedDir, { recursive: true })
  const pathMap: Record<string, string> = {}
  let totalBytes = 0

  const archive = await openZip(source)
  try {
    for await (const entry of iterateEntries(archive)) {
      const entryName = entry.fileName
      if (!entryName.startsWith(PACKAGE_MEDIA_DIR) || entryName.endsWith('/')) {
        continue
      }
      validatePackagePath(entryName)
      if (entry.uncompressedSize > MAX_SINGLE_MEDIA_BYTES) {
        throw new Error(`Package media too large: ${entryName}`)
      }
      totalBytes += entry.uncompressedSize
      if (totalBytes > MAX_TOTAL_MEDIA_BYTES) {
        throw new Error('Package total media size exceeds limit')
      }

      const bytes = await readEntryBytes(archive, entry, entryName)
      const hashPrefix = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)
      const extension = normalizeMediaExtension(entryName)
      const destPath = path.join(importedDir, `${hashPrefix}.${extension}`)
      if (!fs.existsSync(destPath)) {
        await fsp.writeFile(destPath, bytes)
      }
      pathMap[entryName] = destPath
    }
  } finally {
    archive.close()
  }

  return { manifestJson, pathMap }
}

function validatePackagePath(packagePath: string): void {
  if (!packagePath.startsWith(PACKAGE_MEDIA_DIR)) {
    throw new Error(`Invalid package media path: ${packagePath}`)
  }
  const components = packagePath.split(/[\\/]+/)
  if (components.some((component) => !component || component === '.' || component === '..')) {
    throw new Error(`Unsafe package path: ${packagePath}`)
  }
  if (components[0] !== 'media') {
    throw new Error(`Invalid package media path: ${packagePath}`)
  }
}

function normalizeMediaExtension(packagePath: string): string {
  const extension = path.posix.extname(packagePath).replace(/^\./, '').toLowerCase()
  return extension && extension.length <= 8 ? extension : 'bin'
}

function validateManifestVersion(manifestJson: string): void {
  const manifestValue = JSON.parse(manifestJson) as unknown
  if (typeof manifestValue !== 'object' || manifestValue === null || Array.isArray(manifestValue)) {
    throw new Error('Invalid manifest JSON: expected object')
  }
  const formatVersion = (manifestValue as Record<string, unknown>).formatVersion
  const normalizedVersion = typeof formatVersion === 'number' && Number.isFinite(formatVersion)
    ? formatVersion
    : 0
  if (normalizedVersion === 0 || normalizedVersion > SUPPORTED_FORMAT_VERSION) {
    throw new Error(`Unsupported package format version: ${normalizedVersion} (supported <= ${SUPPORTED_FORMAT_VERSION})`)
  }
}

async function readManifest(zipPath: string): Promise<string> {
  const archive = await openZip(zipPath)
  try {
    for await (const entry of iterateEntries(archive)) {
      if (entry.fileName !== PACKAGE_MANIFEST_NAME) {
        continue
      }
      if (entry.uncompressedSize > MAX_MANIFEST_BYTES) {
        throw new Error('Package manifest is too large')
      }
      return (await readEntryBytes(archive, entry, PACKAGE_MANIFEST_NAME)).toString('utf8')
    }
  } finally {
    archive.close()
  }
  throw new Error('Package manifest.json missing')
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (error, archive) => {
      if (error) {
        reject(new Error(`Invalid package file: ${error.message}`))
        return
      }
      if (!archive) {
        reject(new Error('Invalid package file'))
        return
      }
      resolve(archive)
    })
  })
}

async function* iterateEntries(archive: yauzl.ZipFile): AsyncGenerator<yauzl.Entry> {
  while (true) {
    const entry = await readNextEntry(archive)
    if (!entry) {
      return
    }
    yield entry
  }
}

function readNextEntry(archive: yauzl.ZipFile): Promise<yauzl.Entry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: yauzl.Entry): void => {
      cleanup()
      resolve(entry)
    }
    const onEnd = (): void => {
      cleanup()
      resolve(null)
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const cleanup = (): void => {
      archive.off('entry', onEntry)
      archive.off('end', onEnd)
      archive.off('error', onError)
    }
    archive.once('entry', onEntry)
    archive.once('end', onEnd)
    archive.once('error', onError)
    archive.readEntry()
  })
}

function readEntryBytes(archive: yauzl.ZipFile, entry: yauzl.Entry, entryName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    archive.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(new Error(`Failed to extract ${entryName}: ${error.message}`))
        return
      }
      if (!stream) {
        reject(new Error(`Failed to extract ${entryName}`))
        return
      }
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      stream.on('error', (streamError) => {
        reject(new Error(`Failed to extract ${entryName}: ${streamError.message}`))
      })
      stream.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
    })
  })
}
