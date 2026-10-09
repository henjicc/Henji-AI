import { ZipArchive } from 'archiver'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { performance } from 'node:perf_hooks'

import { createMainLogger } from '../logging'
import { replaceFileAtomically } from '../fs/atomic-file'
import type { ImageEditDocumentEnvelope, ResourceId } from './contracts'
import type { ContentAddressedResourceStore } from './resource-store'
import { KeyedSerialExecutor } from './serial-executor'
import { ImageEditHistoryPageStoreV3 } from './history-pages/store'
import { validateImageEditDocumentEnvelope } from './document-repository'
import {
  HENJI_IMAGE_DOCUMENT_HEADER_ENTRY,
  HENJI_IMAGE_PACKAGE_FORMAT,
  HENJI_IMAGE_PACKAGE_MANIFEST,
  HENJI_IMAGE_PACKAGE_VERSION,
  descriptorToPackageResource,
  validateHenjiImagePackageManifest,
  type HenjiImageExternalSource,
  type HenjiImagePackageManifest,
  type HenjiImagePackageResourceInput,
  type HenjiImagePackageThumbnailInput,
} from './package-types'

const logger = createMainLogger('main.image_editor_v3.package')
const exportsByPath = new KeyedSerialExecutor()

export interface ExportHenjiImagePackageRequest {
  targetPath: string
  document: ImageEditDocumentEnvelope
  resourceStore: ContentAddressedResourceStore
  resources?: readonly HenjiImagePackageResourceInput[]
  thumbnail?: HenjiImagePackageThumbnailInput
  externalSources?: readonly HenjiImageExternalSource[]
  /** 图片文档头（3.5）：序列化好的 `henji-document.json` 内容；省略时不写这个条目。 */
  documentHeader?: string
  signal?: AbortSignal
  /** Internal progress port; callers can display saved resources without a second save implementation. */
  onProgress?: (completedResources: number, totalResources: number) => void
  now?: Date
}

function abortError(): Error {
  const error = new Error('.henjiimg export was cancelled')
  error.name = 'AbortError'
  return error
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function normalizeThumbnailExtension(extension: string): 'png' | 'webp' {
  const normalized = extension.trim().replace(/^\./, '').toLowerCase()
  if (normalized !== 'png' && normalized !== 'webp') {
    throw new Error('Invalid .henjiimg thumbnail extension')
  }
  return normalized
}

function uniqueResourceInputs(request: ExportHenjiImagePackageRequest): HenjiImagePackageResourceInput[] {
  const externalIds = new Set(
    (request.externalSources ?? []).map((source) => `sha256:${source.sha256}` as ResourceId),
  )
  const mediaTypes = new Map<ResourceId, string | undefined>()
  for (const resource of request.resources ?? []) {
    if (!externalIds.has(resource.resourceId)) mediaTypes.set(resource.resourceId, resource.mediaType)
  }
  for (const resourceId of request.document.resourceRefs) {
    if (!externalIds.has(resourceId) && !mediaTypes.has(resourceId)) mediaTypes.set(resourceId, undefined)
  }
  // 缩略预览必须自包含，不能跟随外链原图一起缺失。
  if (request.document.previewRef) {
    mediaTypes.set(request.document.previewRef, undefined)
  }
  return [...mediaTypes].map(([resourceId, mediaType]) => ({ resourceId, mediaType }))
}

async function buildManifest(
  request: ExportHenjiImagePackageRequest,
  resources: readonly HenjiImagePackageResourceInput[],
): Promise<HenjiImagePackageManifest> {
  const records = []
  for (const resource of resources) {
    records.push(descriptorToPackageResource(
      await request.resourceStore.describe(resource.resourceId, resource.mediaType),
    ))
  }
  const thumbnail = request.thumbnail
    ? (() => {
      const bytes = Buffer.from(
        request.thumbnail.bytes.buffer,
        request.thumbnail.bytes.byteOffset,
        request.thumbnail.bytes.byteLength,
      )
      const extension = normalizeThumbnailExtension(request.thumbnail.extension)
      const mediaType = `image/${extension}`
      if (request.thumbnail.mediaType !== mediaType) {
        throw new Error('Package thumbnail extension and media type differ')
      }
      return {
        path: `thumbnail/preview.${extension}`,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.byteLength,
        mediaType,
      }
    })()
    : undefined
  return validateHenjiImagePackageManifest({
    packageFormat: HENJI_IMAGE_PACKAGE_FORMAT,
    packageVersion: HENJI_IMAGE_PACKAGE_VERSION,
    createdAt: (request.now ?? new Date()).toISOString(),
    document: request.document,
    resources: records,
    thumbnail,
    externalSources: request.externalSources,
  })
}

async function writeArchive(
  stagedPath: string,
  manifest: HenjiImagePackageManifest,
  serializedManifest: string,
  request: ExportHenjiImagePackageRequest,
): Promise<void> {
  checkAbort(request.signal)
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(stagedPath, { flags: 'wx', mode: 0o600 })
    const archive = new ZipArchive({ zlib: { level: 6 } })
    let settled = false
    let failure: unknown
    let activeInput: Readable | undefined
    const settle = (error?: unknown): void => {
      if (settled) return
      settled = true
      request.signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const fail = (error: unknown): void => {
      failure ??= error
      archive.abort()
      activeInput?.destroy()
      output.destroy()
    }
    const onAbort = (): void => {
      fail(abortError())
    }
    // Wait for the output handle to close before cleaning up the staged file.
    output.once('close', () => settle(failure))
    output.once('error', fail)
    archive.on('error', fail)
    archive.on('warning', fail)
    request.signal?.addEventListener('abort', onAbort, { once: true })
    archive.pipe(output)
    archive.append(serializedManifest, { name: HENJI_IMAGE_PACKAGE_MANIFEST })
    if (request.documentHeader !== undefined) {
      archive.append(request.documentHeader, { name: HENJI_IMAGE_DOCUMENT_HEADER_ENTRY })
    }
    void (async () => {
      let completed = 0
      for (const resource of manifest.resources) {
        checkAbort(request.signal)
        if (failure) throw failure
        // Open just one verified resource at a time. append() queues streams;
        // eagerly opening every resource would retain a handle/buffer per tile.
        await new Promise<void>((done, failed) => {
          const onEntry = (entry: { name: string }): void => {
            if (entry.name !== resource.path) return
            cleanup()
            done()
          }
          const onFailure = (error: unknown): void => { cleanup(); failed(error) }
          const onClose = (): void => onFailure(failure ?? new Error('Package output closed before its resource'))
          const cleanup = (): void => {
            archive.off('entry', onEntry)
            archive.off('error', onFailure)
            output.off('close', onClose)
          }
          archive.on('entry', onEntry)
          archive.once('error', onFailure)
          output.once('close', onClose)
          activeInput = request.resourceStore.openVerifiedReadStream(resource.resourceId)
          activeInput.once('error', fail)
          archive.append(activeInput, { name: resource.path, store: true })
        })
        activeInput = undefined
        request.onProgress?.(++completed, manifest.resources.length)
      }
      checkAbort(request.signal)
      if (manifest.thumbnail && request.thumbnail) {
        archive.append(Buffer.from(request.thumbnail.bytes.buffer,
          request.thumbnail.bytes.byteOffset, request.thumbnail.bytes.byteLength),
        { name: manifest.thumbnail.path, store: true })
      }
      await archive.finalize()
    })().catch(fail)
  })
}

/**
 * 把可编辑图片包完整写到暂存文件并刷盘，不发布（3.5 图片文档写回：先在锁外写好，
 * 再在文档锁内核对版本后原子替换）。失败时删除暂存文件。返回写入的 manifest。
 */
export async function writeHenjiImagePackageStaged(
  request: Omit<ExportHenjiImagePackageRequest, 'targetPath'>,
  stagedPath: string,
): Promise<HenjiImagePackageManifest> {
  const envelope = validateImageEditDocumentEnvelope(request.document)
  const store = new ImageEditHistoryPageStoreV3(request.resourceStore)
  const prepared = envelope.history ? await store.prepare(envelope.history, request.signal) : undefined
  try {
    const { history: _runtimeHistory, ...document } = envelope
    if (prepared) {
      const oldPages = new Set(document.historyCheckpoint?.pages.map(page => page.resourceId))
      document.historyCheckpoint = prepared.checkpoint
      document.resourceRefs = [...new Set([...document.resourceRefs.filter(ref => !oldPages.has(ref)), ...prepared.resourceIds])].sort()
    }
    if (document.historyCheckpoint) await store.validate(document.historyCheckpoint, request.signal)
    return await writePreparedHenjiImagePackageStaged({ ...request, document }, stagedPath)
  } finally { await prepared?.release() }
}

async function writePreparedHenjiImagePackageStaged(
  request: Omit<ExportHenjiImagePackageRequest, 'targetPath'>,
  stagedPath: string,
): Promise<HenjiImagePackageManifest> {
  checkAbort(request.signal)
  const started = performance.now()
  const resourceInputs = uniqueResourceInputs({ ...request, targetPath: stagedPath })
  const resourceIds = resourceInputs.map((resource) => resource.resourceId)
  const lease = await request.resourceStore.acquireLease(resourceIds)
  try {
    await fsp.mkdir(path.dirname(stagedPath), { recursive: true })
    const manifest = await buildManifest({ ...request, targetPath: stagedPath }, resourceInputs)
    checkAbort(request.signal)
    const manifestMs = performance.now() - started
    const serializationStarted = performance.now()
    const serializedManifest = `${JSON.stringify(manifest)}\n`
    const serializationMs = performance.now() - serializationStarted
    const archiveStarted = performance.now()
    await writeArchive(stagedPath, manifest, serializedManifest, { ...request, targetPath: stagedPath })
    checkAbort(request.signal)
    const archiveMs = performance.now() - archiveStarted
    const syncStarted = performance.now()
    // Windows 不允许通过只读句柄执行 FlushFileBuffers。
    const staged = await fsp.open(stagedPath, 'r+')
    try {
      await staged.sync()
    } finally {
      await staged.close()
    }
    checkAbort(request.signal)
    logger.info('图片包暂存完成', {
      event: 'image_editor_v3.package.staged.completed',
      context: { documentId: request.document.documentId, revision: request.document.revision,
        manifestMs, serializationMs, archiveMs, syncMs: performance.now() - syncStarted,
        elapsedMs: performance.now() - started, resourceCount: manifest.resources.length,
        resourceBytes: manifest.resources.reduce((sum, resource) => sum + resource.byteLength, 0) },
    })
    return manifest
  } catch (error) {
    await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await lease.release()
  }
}

/** 暂存文件放在目标旁边（同一磁盘，替换是一次改名）；以点开头、`.tmp` 结尾，作品扫描不会把它当文档。 */
export function stagedPackagePathFor(targetPath: string): string {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`,
  )
}

export async function exportHenjiImagePackage(
  request: ExportHenjiImagePackageRequest,
): Promise<HenjiImagePackageManifest> {
  const targetPath = request.targetPath.trim()
  if (!targetPath) throw new Error('.henjiimg export target path is empty')
  return exportsByPath.run(path.resolve(targetPath), () => exportPackage(request, targetPath))
}

async function exportPackage(request: ExportHenjiImagePackageRequest, targetPath: string): Promise<HenjiImagePackageManifest> {
  const stagedPath = stagedPackagePathFor(targetPath)
  logger.info('开始保存可编辑图片包', {
    event: 'image_editor_v3.package.export.start',
    context: {
      documentId: request.document.documentId,
      revision: request.document.revision,
    },
  })
  try {
    const manifest = await writeHenjiImagePackageStaged(request, stagedPath)
    checkAbort(request.signal)
    await replaceFileAtomically(stagedPath, targetPath)
    logger.info('可编辑图片包保存完成', {
      event: 'image_editor_v3.package.export.completed',
      context: {
        documentId: request.document.documentId,
        revision: request.document.revision,
        resourceCount: manifest.resources.length,
      },
    })
    return manifest
  } catch (error) {
    await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
    logger.error('可编辑图片包保存失败', {
      event: 'image_editor_v3.package.export.failed',
      context: { documentId: request.document.documentId, revision: request.document.revision },
      error,
    })
    throw error
  }
}
