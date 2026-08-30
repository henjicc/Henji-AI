import path from 'node:path'

import type {
  ImageEditDocumentEnvelope,
  ResourceDescriptor,
  ResourceId,
} from './contracts'
import { validateImageEditDocumentEnvelope } from './document-repository'
import { collectPersistedImageEditHistoryResourcesV3 } from './history-persistence'
import { parseResourceId } from './resource-store'

export const HENJI_IMAGE_PACKAGE_FORMAT = 'henjiimg' as const
export const HENJI_IMAGE_PACKAGE_VERSION = 1 as const
export const HENJI_IMAGE_PACKAGE_MANIFEST = 'manifest.json' as const

const HASH_PATTERN = /^[a-f0-9]{64}$/
const THUMBNAIL_PATH_PATTERN = /^thumbnail\/preview\.[a-z0-9]{1,8}$/

export interface HenjiImagePackageResource {
  resourceId: ResourceId
  sha256: string
  byteLength: number
  path: string
  mediaType?: string
}

export interface HenjiImagePackageThumbnail {
  path: string
  sha256: string
  byteLength: number
  mediaType: string
}

export interface HenjiImageExternalSource {
  sha256: string
  byteLength?: number
  pathHint?: string
  relinkHint?: string
}

export interface HenjiImagePackageManifest {
  packageFormat: typeof HENJI_IMAGE_PACKAGE_FORMAT
  packageVersion: typeof HENJI_IMAGE_PACKAGE_VERSION
  createdAt: string
  document: ImageEditDocumentEnvelope
  resources: HenjiImagePackageResource[]
  thumbnail?: HenjiImagePackageThumbnail
  externalSources?: HenjiImageExternalSource[]
}

export interface HenjiImagePackageResourceInput {
  resourceId: ResourceId
  mediaType?: string
}

export interface HenjiImagePackageThumbnailInput {
  bytes: Uint8Array
  extension: string
  mediaType: string
}

export interface HenjiImagePackageLimits {
  maxEntries: number
  maxManifestBytes: number
  maxSingleResourceBytes: number
  maxTotalBytes: number
  maxCompressionRatio: number
  maxThumbnailBytes: number
}

export const DEFAULT_HENJI_IMAGE_PACKAGE_LIMITS: HenjiImagePackageLimits = {
  maxEntries: 50_000,
  maxManifestBytes: 64 * 1024 * 1024,
  maxSingleResourceBytes: 4 * 1024 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024 * 1024,
  maxCompressionRatio: 1_000,
  maxThumbnailBytes: 32 * 1024 * 1024,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) throw new Error(`Invalid ${label} SHA-256`)
  return value
}

function validateByteLength(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Invalid ${label} byte length`)
  return value as number
}

function optionalShortString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 4096) throw new Error(`Invalid ${label}`)
  return value
}

export function packageResourcePath(resourceId: ResourceId): string {
  return `resources/${parseResourceId(resourceId)}`
}

/** 任何非法条目都拒绝整包；绝不把压缩包路径拼到真实目录后再补救。 */
export function validatePackageEntryPath(entryName: string): string {
  if (
    !entryName
    || entryName.includes('\0')
    || entryName.includes('\\')
    || path.posix.isAbsolute(entryName)
    || /^[A-Za-z]:/.test(entryName)
  ) {
    throw new Error(`Unsafe .henjiimg entry path: ${entryName}`)
  }
  const segments = entryName.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe .henjiimg entry path: ${entryName}`)
  }
  if (path.posix.normalize(entryName) !== entryName) {
    throw new Error(`Unsafe .henjiimg entry path: ${entryName}`)
  }
  if (
    entryName !== HENJI_IMAGE_PACKAGE_MANIFEST
    && !/^resources\/[a-f0-9]{64}$/.test(entryName)
    && !THUMBNAIL_PATH_PATTERN.test(entryName)
  ) {
    throw new Error(`Unsupported .henjiimg entry path: ${entryName}`)
  }
  return entryName
}

function parseResource(value: unknown): HenjiImagePackageResource {
  if (!isRecord(value)) throw new Error('Invalid .henjiimg resource record')
  if (typeof value.resourceId !== 'string') throw new Error('Invalid .henjiimg resource id')
  const resourceId = value.resourceId as ResourceId
  const sha256 = validateHash(value.sha256, 'resource')
  if (parseResourceId(resourceId) !== sha256) throw new Error('Resource id does not match SHA-256')
  const expectedPath = packageResourcePath(resourceId)
  if (value.path !== expectedPath) throw new Error(`Invalid package resource path: ${String(value.path)}`)
  return {
    resourceId,
    sha256,
    byteLength: validateByteLength(value.byteLength, 'resource'),
    path: expectedPath,
    mediaType: optionalShortString(value.mediaType, 'resource media type'),
  }
}

function parseThumbnail(value: unknown): HenjiImagePackageThumbnail | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('Invalid .henjiimg thumbnail record')
  if (typeof value.path !== 'string' || !THUMBNAIL_PATH_PATTERN.test(value.path)) {
    throw new Error('Invalid .henjiimg thumbnail path')
  }
  if (typeof value.mediaType !== 'string' || !value.mediaType || value.mediaType.length > 256) {
    throw new Error('Invalid .henjiimg thumbnail media type')
  }
  return {
    path: value.path,
    sha256: validateHash(value.sha256, 'thumbnail'),
    byteLength: validateByteLength(value.byteLength, 'thumbnail'),
    mediaType: value.mediaType,
  }
}

function parseExternalSources(value: unknown): HenjiImageExternalSource[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 64) throw new Error('Invalid external source list')
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error('Invalid external source record')
    return {
      sha256: validateHash(entry.sha256, 'external source'),
      byteLength: entry.byteLength === undefined
        ? undefined
        : validateByteLength(entry.byteLength, 'external source'),
      pathHint: optionalShortString(entry.pathHint, 'external source path hint'),
      relinkHint: optionalShortString(entry.relinkHint, 'external source relink hint'),
    }
  })
}

export function validateHenjiImagePackageManifest(value: unknown): HenjiImagePackageManifest {
  if (!isRecord(value)) throw new Error('Invalid .henjiimg manifest: expected object')
  if (value.packageFormat !== HENJI_IMAGE_PACKAGE_FORMAT || value.packageVersion !== HENJI_IMAGE_PACKAGE_VERSION) {
    throw new Error('Unsupported .henjiimg package format')
  }
  if (typeof value.createdAt !== 'string') throw new Error('Invalid .henjiimg creation time')
  if (!Array.isArray(value.resources)) throw new Error('Invalid .henjiimg resource list')
  const resources = value.resources.map(parseResource)
  const ids = new Set<ResourceId>()
  for (const resource of resources) {
    if (ids.has(resource.resourceId)) throw new Error(`Duplicate package resource: ${resource.resourceId}`)
    ids.add(resource.resourceId)
  }
  const document = validateImageEditDocumentEnvelope(value.document)
  const externalSources = parseExternalSources(value.externalSources)
  const externalIds = new Set<ResourceId>()
  for (const source of externalSources ?? []) {
    const resourceId = `sha256:${source.sha256}` as ResourceId
    if (externalIds.has(resourceId)) throw new Error(`Duplicate external source: ${resourceId}`)
    if (ids.has(resourceId)) throw new Error(`Resource cannot be both embedded and external: ${resourceId}`)
    externalIds.add(resourceId)
  }
  const required = new Set(document.resourceRefs)
  if (document.previewRef && !ids.has(document.previewRef)) {
    throw new Error(`Package preview resource must be embedded: ${document.previewRef}`)
  }
  for (const resourceId of required) {
    if (!ids.has(resourceId) && !externalIds.has(resourceId)) {
      throw new Error(`Package resource missing from manifest: ${resourceId}`)
    }
  }
  const embeddedById = new Map(resources.map((resource) => [resource.resourceId, resource]))
  const externalById = new Map((externalSources ?? []).map((source) => (
    [`sha256:${source.sha256}` as ResourceId, source]
  )))
  for (const historyResource of collectPersistedImageEditHistoryResourcesV3(document.history)) {
    if (historyResource.byteSize === null) continue
    const embedded = embeddedById.get(historyResource.resourceId as ResourceId)
    const external = externalById.get(historyResource.resourceId as ResourceId)
    const actualBytes = embedded?.byteLength ?? external?.byteLength
    if (actualBytes !== historyResource.byteSize) {
      throw new Error(`History resource byte length mismatch: ${historyResource.resourceId}`)
    }
  }
  return {
    packageFormat: HENJI_IMAGE_PACKAGE_FORMAT,
    packageVersion: HENJI_IMAGE_PACKAGE_VERSION,
    createdAt: value.createdAt,
    document,
    resources,
    thumbnail: parseThumbnail(value.thumbnail),
    externalSources,
  }
}

export function descriptorToPackageResource(
  descriptor: ResourceDescriptor,
): HenjiImagePackageResource {
  return {
    resourceId: descriptor.id,
    sha256: descriptor.sha256,
    byteLength: descriptor.byteLength,
    path: packageResourcePath(descriptor.id),
    mediaType: descriptor.mediaType,
  }
}
