import { ZipArchive } from 'archiver'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { createMainLogger } from '../logging'
import { replaceFileAtomically } from './atomic-file'
import type { ImageEditDocumentEnvelope, ResourceId } from './contracts'
import type { ContentAddressedResourceStore } from './resource-store'
import {
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

export interface ExportHenjiImagePackageRequest {
  targetPath: string
  document: ImageEditDocumentEnvelope
  resourceStore: ContentAddressedResourceStore
  resources?: readonly HenjiImagePackageResourceInput[]
  thumbnail?: HenjiImagePackageThumbnailInput
  externalSources?: readonly HenjiImageExternalSource[]
  signal?: AbortSignal
  now?: Date
}

function abortError(): Error {
  const error = new Error('.henjiimg export was cancelled')
  error.name = 'AbortError'
  return error
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
  request: ExportHenjiImagePackageRequest,
): Promise<void> {
  if (request.signal?.aborted) throw abortError()
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(stagedPath, { flags: 'wx', mode: 0o600 })
    const archive = new ZipArchive({ zlib: { level: 6 } })
    let settled = false
    const settle = (error?: unknown): void => {
      if (settled) return
      settled = true
      request.signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onAbort = (): void => {
      archive.abort()
      output.destroy(abortError())
    }
    output.once('close', () => settle())
    output.once('error', settle)
    archive.once('error', settle)
    archive.once('warning', settle)
    request.signal?.addEventListener('abort', onAbort, { once: true })
    archive.pipe(output)
    archive.append(`${JSON.stringify(manifest)}\n`, { name: HENJI_IMAGE_PACKAGE_MANIFEST })
    for (const resource of manifest.resources) {
      // 图片/瓦片通常已经压缩，store 避免对 200MP 资源重复执行高成本 deflate。
      archive.append(request.resourceStore.openVerifiedReadStream(resource.resourceId), {
        name: resource.path,
        store: true,
      })
    }
    if (manifest.thumbnail && request.thumbnail) {
      archive.append(Buffer.from(
        request.thumbnail.bytes.buffer,
        request.thumbnail.bytes.byteOffset,
        request.thumbnail.bytes.byteLength,
      ), { name: manifest.thumbnail.path })
    }
    void archive.finalize().catch(settle)
  })
}

export async function exportHenjiImagePackage(
  request: ExportHenjiImagePackageRequest,
): Promise<HenjiImagePackageManifest> {
  const targetPath = request.targetPath.trim()
  if (!targetPath) throw new Error('.henjiimg export target path is empty')
  const resourceInputs = uniqueResourceInputs(request)
  const resourceIds = resourceInputs.map((resource) => resource.resourceId)
  const lease = await request.resourceStore.acquireLease(resourceIds)
  const stagedPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`,
  )
  logger.info('开始保存可编辑图片包', {
    event: 'image_editor_v3.package.export.start',
    context: {
      documentId: request.document.documentId,
      revision: request.document.revision,
      resourceCount: resourceIds.length,
    },
  })
  try {
    await fsp.mkdir(path.dirname(targetPath), { recursive: true })
    const manifest = await buildManifest(request, resourceInputs)
    await writeArchive(stagedPath, manifest, request)
    const staged = await fsp.open(stagedPath, 'r')
    try {
      await staged.sync()
    } finally {
      await staged.close()
    }
    await replaceFileAtomically(stagedPath, targetPath)
    logger.info('可编辑图片包保存完成', {
      event: 'image_editor_v3.package.export.completed',
      context: {
        documentId: request.document.documentId,
        revision: request.document.revision,
        resourceCount: resourceIds.length,
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
  } finally {
    await lease.release()
  }
}
