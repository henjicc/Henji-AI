import { ZipArchive } from 'archiver'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { getDataRootDir } from './image/path-utils'
import { iterateEntries, openZip, readEntryBytes } from './zip-archive'
import { createMainLogger } from './logging'
import {
  IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
  parseImageEditProjectPackageExtensionV3,
  type ImageEditProjectPackageReferenceMappingV3,
} from '../../../src/core/imageEdit/v3/projectPackageContracts'
import {
  ContentAddressedResourceStore,
  ImageEditDocumentRepository,
  getImageEditorV3StoragePaths,
} from './image-editor-v3'
import {
  importProjectImageEditorV3Bundle,
  prepareProjectImageEditorV3Export,
  type ProjectImageEditorV3Dependencies,
} from './project-package-image-editor-v3'
import {
  importProjectMediaEntriesAtomically,
  stageProjectImageEditorV3Entries,
  type StagedProjectImageEditorV3Entries,
} from './project-package-entry-import'

export { importProjectMediaEntriesAtomically } from './project-package-entry-import'

const PACKAGE_MANIFEST_NAME = 'manifest.json'
const PACKAGE_MEDIA_DIR = 'media/'
const SUPPORTED_FORMAT_VERSION = 2
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024

const logger = createMainLogger('main.project_package')

export interface PackageMediaFileDto {
  srcPath: string
  packagePath: string
}

export interface ImportedProjectPackageDto {
  manifestJson: string
  pathMap: Record<string, string>
  imageEditReferences: ImageEditProjectPackageReferenceMappingV3[]
}

export interface ProjectPackageServiceDependencies {
  dataRootDir?: string
  imageEditorV3?: ProjectImageEditorV3Dependencies
}

function resolveImageEditorV3Dependencies(
  dependencies: ProjectPackageServiceDependencies,
): ProjectImageEditorV3Dependencies {
  if (dependencies.imageEditorV3) return dependencies.imageEditorV3
  const paths = getImageEditorV3StoragePaths(dependencies.dataRootDir ?? getDataRootDir())
  return {
    documents: new ImageEditDocumentRepository(paths.documentsDir),
    resources: new ContentAddressedResourceStore(paths.resourcesDir),
  }
}

function parseProjectManifest(manifestJson: string): Record<string, unknown> {
  const value = JSON.parse(manifestJson) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid manifest JSON: expected object')
  }
  return value as Record<string, unknown>
}

export async function exportProjectPackage(
  manifestJson: string,
  mediaFiles: PackageMediaFileDto[],
  targetPath: string,
  dependencies: ProjectPackageServiceDependencies = {},
): Promise<void> {
  const target = targetPath.trim()
  if (!target) {
    throw new Error('Export target path is empty')
  }

  const manifest = parseProjectManifest(manifestJson)
  validateManifestVersionValue(manifest)
  const rawImageEditorV3 = manifest.imageEditorV3
  if (rawImageEditorV3 !== undefined && Number(manifest.formatVersion) < 2) {
    throw new Error('Image editor V3 project data requires package format version 2')
  }
  const imageEditorV3Dependencies = rawImageEditorV3 === undefined
    ? null
    : resolveImageEditorV3Dependencies(dependencies)
  const preparedImageEditorV3 = rawImageEditorV3 === undefined
    ? null
    : await prepareProjectImageEditorV3Export(
      parseImageEditProjectPackageExtensionV3(rawImageEditorV3),
      imageEditorV3Dependencies as ProjectImageEditorV3Dependencies,
    )

  logger.info('开始导出项目包', {
    event: 'project_package.export.start',
    context: {
      mediaCount: mediaFiles.length,
      imageEditDocumentCount: preparedImageEditorV3?.manifest.documents.length ?? 0,
    },
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
      writtenPaths.add(PACKAGE_MANIFEST_NAME)

      for (const media of mediaFiles) {
        validatePackagePath(media.packagePath)
        if (writtenPaths.has(media.packagePath)) {
          throw new Error(`Duplicate package entry: ${media.packagePath}`)
        }
        archive.file(media.srcPath, { name: media.packagePath })
        writtenPaths.add(media.packagePath)
      }

      if (preparedImageEditorV3) {
        archive.append(`${JSON.stringify(preparedImageEditorV3.manifest)}\n`, {
          name: IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
        })
        writtenPaths.add(IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3)
        for (const resource of preparedImageEditorV3.resources) {
          if (writtenPaths.has(resource.path)) throw new Error(`Duplicate package entry: ${resource.path}`)
          archive.append(
            (imageEditorV3Dependencies as ProjectImageEditorV3Dependencies)
              .resources.openVerifiedReadStream(resource.resourceId),
            { name: resource.path, store: true },
          )
          writtenPaths.add(resource.path)
        }
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
  } finally {
    await preparedImageEditorV3?.lease.release()
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

export async function importProjectPackage(
  zipPath: string,
  dependencies: ProjectPackageServiceDependencies = {},
): Promise<ImportedProjectPackageDto> {
  const source = zipPath.trim()
  if (!source) {
    throw new Error('Package path is empty')
  }

  logger.info('开始导入项目包', { event: 'project_package.import.start' })
  try {
    const manifestJson = await readManifest(source)
    const manifest = parseProjectManifest(manifestJson)
    validateManifestVersionValue(manifest)
    const rawImageEditorV3 = manifest.imageEditorV3
    if (rawImageEditorV3 !== undefined && Number(manifest.formatVersion) < 2) {
      throw new Error('Image editor V3 project data requires package format version 2')
    }
    const extension = rawImageEditorV3 === undefined
      ? null
      : parseImageEditProjectPackageExtensionV3(rawImageEditorV3)

    const dataRootDir = dependencies.dataRootDir ?? getDataRootDir()
    const importedDir = path.join(dataRootDir, 'Uploads', 'imported')
    await fsp.mkdir(importedDir, { recursive: true })
    const stagingDir = await fsp.mkdtemp(path.join(importedDir, '.project-v3-import-'))
    let importedMedia: Awaited<ReturnType<typeof importProjectMediaEntriesAtomically>> | undefined
    try {
      let stagedImageEditorV3: StagedProjectImageEditorV3Entries
      const v3Archive = await openZip(source)
      try {
        stagedImageEditorV3 = await stageProjectImageEditorV3Entries(
          v3Archive,
          stagingDir,
          extension !== null,
        )
      } finally {
        v3Archive.close()
      }
      const mediaArchive = await openZip(source)
      try {
        importedMedia = await importProjectMediaEntriesAtomically(
          iterateEntries(mediaArchive),
          importedDir,
          (entry, entryName) => readEntryBytes(mediaArchive, entry, entryName),
        )
        let imageEditReferences: ImageEditProjectPackageReferenceMappingV3[] = []
        if (extension) {
          if (!stagedImageEditorV3.manifestJson) {
            throw new Error('Project image editor V3 bundle manifest missing')
          }
          imageEditReferences = await importProjectImageEditorV3Bundle(
            extension,
            JSON.parse(stagedImageEditorV3.manifestJson) as unknown,
            stagedImageEditorV3.resources,
            resolveImageEditorV3Dependencies(dependencies),
          )
        }
        logger.info('项目包导入完成', {
          event: 'project_package.import.completed',
          context: {
            mediaCount: Object.keys(importedMedia.pathMap).length,
            totalBytes: importedMedia.totalBytes,
            imageEditDocumentCount: imageEditReferences.length,
          },
        })
        return { manifestJson, pathMap: importedMedia.pathMap, imageEditReferences }
      } finally {
        mediaArchive.close()
      }
    } catch (error) {
      await Promise.all((importedMedia?.createdPaths ?? []).map((filePath) => (
        fsp.rm(filePath, { force: true })
      )))
      throw error
    } finally {
      await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
    }
  } catch (error) {
    logger.error('项目包导入失败', {
      event: 'project_package.import.failed',
      error: toLogError(error),
    })
    throw error
  }
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

function validateManifestVersionValue(manifestValue: Record<string, unknown>): void {
  const formatVersion = manifestValue.formatVersion
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
