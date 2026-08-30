import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import type * as yauzl from 'yauzl'

import { createMainLogger } from '../logging'
import { isSymbolicLinkEntry, iterateEntries, openZip } from '../zip-archive'
import type { ResourceDescriptor } from './contracts'
import type { ContentAddressedResourceStore } from './resource-store'
import {
  DEFAULT_HENJI_IMAGE_PACKAGE_LIMITS,
  HENJI_IMAGE_PACKAGE_MANIFEST,
  validateHenjiImagePackageManifest,
  validatePackageEntryPath,
  type HenjiImagePackageLimits,
  type HenjiImagePackageManifest,
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
  limits?: Partial<HenjiImagePackageLimits>
  signal?: AbortSignal
}

export interface ImportedHenjiImagePackage {
  manifest: HenjiImagePackageManifest
  resources: ResourceDescriptor[]
  thumbnail?: Buffer
}

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
    const thumbnail = manifest.thumbnail
      ? await fsp.readFile(staged.get(manifest.thumbnail.path)?.filePath ?? '')
      : undefined
    logger.info('可编辑图片包导入完成', {
      event: 'image_editor_v3.package.import.completed',
      context: {
        documentId: manifest.document.documentId,
        revision: manifest.document.revision,
        resourceCount: resources.length,
      },
    })
    return { manifest, resources, thumbnail }
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
