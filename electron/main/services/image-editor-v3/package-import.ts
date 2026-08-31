import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import type * as yauzl from 'yauzl'

import { createMainLogger } from '../logging'
import { isSymbolicLinkEntry, iterateEntries, openZip } from '../zip-archive'
import type {
  ResourceDescriptor,
  ResourceId,
  ResourceLease,
  SourceImageMetadata,
  SourceProvider,
} from './contracts'
import type { ContentAddressedResourceStore } from './resource-store'
import {
  DEFAULT_HENJI_IMAGE_PACKAGE_LIMITS,
  HENJI_IMAGE_PACKAGE_MANIFEST,
  validateHenjiImagePackageManifest,
  validatePackageEntryPath,
  type HenjiImagePackageLimits,
  type HenjiImagePackageManifest,
  type HenjiImageExternalSource,
} from './package-types'

const logger = createMainLogger('main.image_editor_v3.package')

interface StagedEntry {
  archivePath: string
  filePath: string
  sha256: string
  byteLength: number
}

export interface ImportHenjiImagePackageRequest {
  sourcePath: string
  resourceStore: ContentAddressedResourceStore
  /** 提供时同时验证外链命中资源确实是声明的可解码栅格图片。 */
  sourceProvider?: SourceProvider
  limits?: Partial<HenjiImagePackageLimits>
  signal?: AbortSignal
}

export interface ImportedHenjiImagePackage {
  manifest: HenjiImagePackageManifest
  resources: ResourceDescriptor[]
  missingExternalSources: HenjiImageMissingExternalSource[]
  thumbnail?: Buffer
  /** 导入完成前即取得；调用方必须在文档引用原子落盘后释放。 */
  resourceLease: ResourceLease
}

export interface HenjiImageMissingExternalSource extends HenjiImageExternalSource {
  resourceId: ResourceId
}

export interface RelinkHenjiImageExternalSourceRequest {
  sourcePath: string
  externalSource: HenjiImageMissingExternalSource
  resourceStore: ContentAddressedResourceStore
  sourceProvider: SourceProvider
  signal?: AbortSignal
}

export interface RelinkedHenjiImageExternalSource {
  resource: ResourceDescriptor
  resourceLease: ResourceLease
}

const MAX_RELINK_SOURCE_BYTES = 8 * 1024 * 1024 * 1024

function abortError(): Error {
  const error = new Error('.henjiimg import was cancelled')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function resolveLimits(overrides?: Partial<HenjiImagePackageLimits>): HenjiImagePackageLimits {
  const limits = { ...DEFAULT_HENJI_IMAGE_PACKAGE_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid .henjiimg limit: ${name}`)
  }
  return limits
}

function mediaTypeForMetadata(metadata: SourceImageMetadata): string | null {
  switch (metadata.format?.toLowerCase()) {
    case 'png': return 'image/png'
    case 'jpeg':
    case 'jpg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'tiff': return 'image/tiff'
    case 'avif': return 'image/avif'
    case 'heif': return 'image/heif'
    case 'gif': return 'image/gif'
    default: return null
  }
}

function mediaTypesMatch(expected: string, actual: string): boolean {
  if (expected === actual) return true
  return (expected === 'image/avif' || expected === 'image/heif')
    && (actual === 'image/avif' || actual === 'image/heif')
}

async function assertExternalSourceMedia(
  resourceId: ResourceId,
  externalSource: HenjiImageExternalSource,
  sourceProvider: SourceProvider | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!sourceProvider) return externalSource.mediaType
  const metadata = await sourceProvider.readMetadata(resourceId, signal)
  const actualMediaType = mediaTypeForMetadata(metadata)
  if (!actualMediaType) throw new Error(`Unsupported external image media: ${metadata.format ?? 'unknown'}`)
  if (externalSource.mediaType && !mediaTypesMatch(externalSource.mediaType, actualMediaType)) {
    throw new Error(
      `External source media type mismatch: expected ${externalSource.mediaType}, received ${actualMediaType}`,
    )
  }
  return externalSource.mediaType ?? actualMediaType
}

function openEntryStream(archive: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    archive.openReadStream(entry, (error, stream) => {
      if (error) reject(new Error(`Failed to extract ${entry.fileName}: ${error.message}`))
      else if (!stream) reject(new Error(`Failed to extract ${entry.fileName}`))
      else resolve(stream)
    })
  })
}

async function writeEntryToStage(
  archive: yauzl.ZipFile,
  entry: yauzl.Entry,
  filePath: string,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<StagedEntry> {
  throwIfAborted(signal)
  const stream = await openEntryStream(archive, entry)
  const handle = await fsp.open(filePath, 'wx', 0o600)
  const hash = crypto.createHash('sha256')
  let byteLength = 0
  const onAbort = (): void => {
    stream.destroy(abortError())
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const value of stream) {
      throwIfAborted(signal)
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
      byteLength += chunk.byteLength
      if (byteLength > maximumBytes) throw new Error(`.henjiimg entry exceeds limit: ${entry.fileName}`)
      hash.update(chunk)
      await handle.writeFile(chunk)
    }
    await handle.sync()
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await handle.close()
  }
  if (byteLength !== entry.uncompressedSize) {
    throw new Error(`.henjiimg entry size mismatch: ${entry.fileName}`)
  }
  return {
    archivePath: entry.fileName,
    filePath,
    sha256: hash.digest('hex'),
    byteLength,
  }
}

function entryLimit(entryName: string, limits: HenjiImagePackageLimits): number {
  if (entryName === HENJI_IMAGE_PACKAGE_MANIFEST) return limits.maxManifestBytes
  if (entryName.startsWith('thumbnail/')) return limits.maxThumbnailBytes
  return limits.maxSingleResourceBytes
}

function validateEntryHeader(
  entry: yauzl.Entry,
  limits: HenjiImagePackageLimits,
  entryCount: number,
  totalBytes: number,
): void {
  if (entryCount > limits.maxEntries) throw new Error('.henjiimg entry count exceeds limit')
  if (isSymbolicLinkEntry(entry)) throw new Error(`.henjiimg contains symbolic link: ${entry.fileName}`)
  validatePackageEntryPath(entry.fileName)
  const maximum = entryLimit(entry.fileName, limits)
  if (entry.uncompressedSize > maximum) throw new Error(`.henjiimg entry exceeds limit: ${entry.fileName}`)
  if (totalBytes > limits.maxTotalBytes) throw new Error('.henjiimg expanded size exceeds limit')
  const ratio = entry.uncompressedSize === 0
    ? 0
    : entry.uncompressedSize / Math.max(1, entry.compressedSize)
  if (ratio > limits.maxCompressionRatio) {
    throw new Error(`.henjiimg suspicious compression ratio: ${entry.fileName}`)
  }
}

async function stageArchive(
  sourcePath: string,
  stagingDir: string,
  limits: HenjiImagePackageLimits,
  signal?: AbortSignal,
): Promise<Map<string, StagedEntry>> {
  const archive = await openZip(sourcePath)
  const staged = new Map<string, StagedEntry>()
  let entryCount = 0
  let totalBytes = 0
  try {
    for await (const entry of iterateEntries(archive)) {
      throwIfAborted(signal)
      entryCount += 1
      totalBytes += entry.uncompressedSize
      validateEntryHeader(entry, limits, entryCount, totalBytes)
      if (staged.has(entry.fileName)) throw new Error(`Duplicate .henjiimg entry: ${entry.fileName}`)
      const filePath = path.join(stagingDir, `${entryCount.toString().padStart(8, '0')}.entry`)
      const record = await writeEntryToStage(
        archive,
        entry,
        filePath,
        entryLimit(entry.fileName, limits),
        signal,
      )
      staged.set(entry.fileName, record)
    }
  } finally {
    archive.close()
  }
  return staged
}

function verifyManifestEntries(
  manifest: HenjiImagePackageManifest,
  staged: ReadonlyMap<string, StagedEntry>,
): void {
  const expectedPaths = new Set<string>([HENJI_IMAGE_PACKAGE_MANIFEST])
  for (const resource of manifest.resources) {
    expectedPaths.add(resource.path)
    const entry = staged.get(resource.path)
    if (!entry) throw new Error(`Package resource entry missing: ${resource.path}`)
    if (entry.sha256 !== resource.sha256 || entry.byteLength !== resource.byteLength) {
      throw new Error(`Package resource hash or size mismatch: ${resource.path}`)
    }
    if (resource.path !== `resources/${entry.sha256}`) {
      throw new Error(`Package resource path does not match content: ${resource.path}`)
    }
  }
  if (manifest.thumbnail) {
    expectedPaths.add(manifest.thumbnail.path)
    const entry = staged.get(manifest.thumbnail.path)
    if (
      !entry
      || entry.sha256 !== manifest.thumbnail.sha256
      || entry.byteLength !== manifest.thumbnail.byteLength
    ) {
      throw new Error('Package thumbnail hash or size mismatch')
    }
  }
  for (const entryPath of staged.keys()) {
    if (!expectedPaths.has(entryPath)) throw new Error(`Undeclared .henjiimg entry: ${entryPath}`)
  }
}

export async function importHenjiImagePackage(
  request: ImportHenjiImagePackageRequest,
): Promise<ImportedHenjiImagePackage> {
  const sourcePath = request.sourcePath.trim()
  if (!sourcePath) throw new Error('.henjiimg source path is empty')
  const limits = resolveLimits(request.limits)
  await request.resourceStore.initialize()
  const stagingDir = await fsp.mkdtemp(path.join(request.resourceStore.rootDir, '.henjiimg-import-'))
  logger.info('开始导入可编辑图片包', { event: 'image_editor_v3.package.import.start' })
  try {
    const staged = await stageArchive(sourcePath, stagingDir, limits, request.signal)
    const manifestEntry = staged.get(HENJI_IMAGE_PACKAGE_MANIFEST)
    if (!manifestEntry) throw new Error('.henjiimg manifest.json missing')
    const manifest = validateHenjiImagePackageManifest(
      JSON.parse(await fsp.readFile(manifestEntry.filePath, 'utf8')) as unknown,
    )
    verifyManifestEntries(manifest, staged)
    const resources: ResourceDescriptor[] = []
    for (const resource of manifest.resources) {
      throwIfAborted(request.signal)
      const entry = staged.get(resource.path)
      if (!entry) throw new Error(`Package resource entry missing: ${resource.path}`)
      const stored = await request.resourceStore.putFile(entry.filePath, {
        expectedSha256: resource.sha256,
        mediaType: resource.mediaType,
        signal: request.signal,
      })
      resources.push(stored)
    }
    const missingExternalSources: HenjiImageMissingExternalSource[] = []
    for (const source of manifest.externalSources ?? []) {
      throwIfAborted(request.signal)
      const resourceId = `sha256:${source.sha256}` as ResourceId
      if (!(await request.resourceStore.has(resourceId))) {
        missingExternalSources.push({ ...source, resourceId })
        continue
      }
      const verified = await request.resourceStore.verify(resourceId, request.signal)
      if (source.byteLength !== undefined && verified.byteLength !== source.byteLength) {
        throw new Error(`External source byte length mismatch: ${resourceId}`)
      }
      const mediaType = await assertExternalSourceMedia(
        resourceId,
        source,
        request.sourceProvider,
        request.signal,
      )
      resources.push({ ...verified, mediaType })
    }
    const thumbnail = manifest.thumbnail
      ? await fsp.readFile(staged.get(manifest.thumbnail.path)?.filePath ?? '')
      : undefined
    const resourceLease = await request.resourceStore.acquireLease(
      resources.map((resource) => resource.id),
    )
    logger.info('可编辑图片包导入完成', {
      event: 'image_editor_v3.package.import.completed',
      context: {
        documentId: manifest.document.documentId,
        revision: manifest.document.revision,
        resourceCount: resources.length,
      },
    })
    return { manifest, resources, missingExternalSources, thumbnail, resourceLease }
  } catch (error) {
    logger.error('可编辑图片包导入失败', {
      event: 'image_editor_v3.package.import.failed',
      error,
    })
    throw error
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * 原生文件选择器给出的单个候选只会在哈希、精确字节数和可解码图片媒体类型全部匹配后入库。
 * 返回 lease 让调用方把资源一直保护到文档引用完成原子落盘。
 */
export async function relinkHenjiImageExternalSource(
  request: RelinkHenjiImageExternalSourceRequest,
): Promise<RelinkedHenjiImageExternalSource> {
  const sourcePath = request.sourcePath.trim()
  if (!sourcePath || !path.isAbsolute(sourcePath) || sourcePath.includes('\0')) {
    throw new Error('External source relink path must be an absolute local path')
  }
  const expectedBytes = request.externalSource.byteLength
  if (expectedBytes !== undefined && expectedBytes < 1) {
    throw new Error('External image source byte length must be positive')
  }
  let createdResource: ResourceId | null = null
  let resourceLease: ResourceLease | null = null
  try {
    const stored = await request.resourceStore.putFile(sourcePath, {
      expectedSha256: request.externalSource.sha256,
      mediaType: request.externalSource.mediaType,
      maxBytes: expectedBytes ?? MAX_RELINK_SOURCE_BYTES,
      signal: request.signal,
    })
    if (expectedBytes !== undefined && stored.byteLength !== expectedBytes) {
      throw new Error(
        `External source byte length mismatch: expected ${expectedBytes}, received ${stored.byteLength}`,
      )
    }
    if (stored.created) createdResource = stored.id
    resourceLease = await request.resourceStore.acquireLease([stored.id])
    const mediaType = await assertExternalSourceMedia(
      stored.id,
      request.externalSource,
      request.sourceProvider,
      request.signal,
    )
    return {
      resource: { ...stored, mediaType },
      resourceLease,
    }
  } catch (error) {
    await resourceLease?.release().catch(() => undefined)
    if (createdResource) {
      await request.resourceStore.discardCreated([createdResource]).catch(() => undefined)
    }
    throw error
  }
}
