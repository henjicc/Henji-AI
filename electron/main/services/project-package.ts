import { ZipArchive } from 'archiver'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { getDataRootDir } from './image/path-utils'
import { iterateEntries, openZip, readEntryBytes } from './zip-archive'
import { createMainLogger } from './logging'

const PACKAGE_MANIFEST_NAME = 'manifest.json'
const PACKAGE_MEDIA_DIR = 'media/'
const SUPPORTED_FORMAT_VERSION = 1
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024
const MAX_SINGLE_MEDIA_BYTES = 4 * 1024 * 1024 * 1024
const MAX_TOTAL_MEDIA_BYTES = 16 * 1024 * 1024 * 1024

const logger = createMainLogger('main.project_package')

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

  logger.info('开始导出项目包', {
    event: 'project_package.export.start',
    context: { mediaCount: mediaFiles.length },
  })

  const temporaryTarget = `${target}.${crypto.randomUUID()}.tmp`
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(temporaryTarget, { flags: 'wx' })
      const archive = new ZipArchive({ zlib: { level: 9 } })
      const writtenPaths = new Set<string>()

      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
      archive.on('warning', reject)
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
    await replaceFileAtomically(temporaryTarget, target)
    logger.info('项目包导出完成', {
      event: 'project_package.export.completed',
      context: { mediaCount: mediaFiles.length },
    })
  } catch (error) {
    await fsp.rm(temporaryTarget, { force: true }).catch(() => undefined)
    logger.error('项目包导出失败', {
      event: 'project_package.export.failed',
      context: { mediaCount: mediaFiles.length },
      error: toLogError(error),
    })
    throw error
  }
}

export async function replaceFileAtomically(
  stagedPath: string,
  targetPath: string,
  renameFile: (source: string, target: string) => Promise<void> = fsp.rename,
): Promise<void> {
  const targetExists = await fsp.access(targetPath).then(() => true).catch(() => false)
  if (!targetExists) {
    await renameFile(stagedPath, targetPath)
    return
  }

  const backupPath = `${targetPath}.${crypto.randomUUID()}.bak`
  await renameFile(targetPath, backupPath)
  try {
    await renameFile(stagedPath, targetPath)
    await fsp.rm(backupPath, { force: true })
  } catch (error) {
    await renameFile(backupPath, targetPath).catch(() => undefined)
    throw error
  }
}

export async function importProjectPackage(zipPath: string): Promise<ImportedProjectPackageDto> {
  const source = zipPath.trim()
  if (!source) {
    throw new Error('Package path is empty')
  }

  logger.info('开始导入项目包', { event: 'project_package.import.start' })
  try {
    const manifestJson = await readManifest(source)
    validateManifestVersion(manifestJson)

    const importedDir = path.join(getDataRootDir(), 'Uploads', 'imported')
    await fsp.mkdir(importedDir, { recursive: true })
    const archive = await openZip(source)
    try {
      const imported = await importProjectMediaEntriesAtomically(
        iterateEntries(archive),
        importedDir,
        (entry, entryName) => readEntryBytes(archive, entry, entryName),
      )
      logger.info('项目包导入完成', {
        event: 'project_package.import.completed',
        context: { mediaCount: Object.keys(imported.pathMap).length, totalBytes: imported.totalBytes },
      })
      return { manifestJson, pathMap: imported.pathMap }
    } finally {
      archive.close()
    }
  } catch (error) {
    logger.error('项目包导入失败', {
      event: 'project_package.import.failed',
      error: toLogError(error),
    })
    throw error
  }
}

interface ProjectPackageMediaEntryLike {
  fileName: string
  uncompressedSize: number
}

export async function importProjectMediaEntriesAtomically<TEntry extends ProjectPackageMediaEntryLike>(
  entries: AsyncIterable<TEntry>,
  importedDir: string,
  readBytes: (entry: TEntry, entryName: string) => Promise<Buffer>,
): Promise<{ pathMap: Record<string, string>; totalBytes: number }> {
  const pathMap: Record<string, string> = {}
  const createdPaths: string[] = []
  let totalBytes = 0
  try {
    for await (const entry of entries) {
      const entryName = entry.fileName
      if (!entryName.startsWith(PACKAGE_MEDIA_DIR) || entryName.endsWith('/')) continue
      validatePackagePath(entryName)
      if (entry.uncompressedSize > MAX_SINGLE_MEDIA_BYTES) {
        throw new Error(`Package media too large: ${entryName}`)
      }
      totalBytes += entry.uncompressedSize
      if (totalBytes > MAX_TOTAL_MEDIA_BYTES) {
        throw new Error('Package total media size exceeds limit')
      }

      const bytes = await readBytes(entry, entryName)
      const hashPrefix = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)
      const extension = normalizeMediaExtension(entryName)
      const destPath = path.join(importedDir, `${hashPrefix}.${extension}`)
      try {
        await fsp.writeFile(destPath, bytes, { flag: 'wx' })
        createdPaths.push(destPath)
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error
      }
      pathMap[entryName] = destPath
    }
    return { pathMap, totalBytes }
  } catch (error) {
    await Promise.all(createdPaths.map((filePath) => fsp.rm(filePath, { force: true })))
    throw error
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function toLogError(error: unknown): unknown {
  return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error
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
