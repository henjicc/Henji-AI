import crypto from 'node:crypto'

import {
  IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
  parseImageEditProjectPackageDocumentReferenceV3,
  parseImageEditProjectPackageExtensionV3,
  type ImageEditProjectPackageDocumentReferenceV3,
  type ImageEditProjectPackageExtensionV3,
  type ImageEditProjectPackageReferenceMappingV3,
} from '../../../src/core/imageEdit/v3/projectPackageContracts'
import {
  ContentAddressedResourceStore,
  ImageEditDocumentRepository,
  collectPersistedImageEditHistoryResourcesV3,
  parseResourceId,
  toDocumentRef,
  validateImageEditDocumentEnvelope,
  type ImageEditDocumentEnvelope,
  type ResourceId,
  type ResourceLease,
} from './image-editor-v3'

export const PROJECT_IMAGE_EDITOR_V3_BUNDLE_FORMAT = 'henji-project-image-edit-v3' as const
export const PROJECT_IMAGE_EDITOR_V3_BUNDLE_VERSION = 1 as const
export const PROJECT_IMAGE_EDITOR_V3_RESOURCE_PREFIX = 'image-editor-v3/resources/' as const

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/

export interface ProjectImageEditorV3BundleResource {
  resourceId: ResourceId
  sha256: string
  byteLength: number
  path: string
  mediaType?: string
}

export interface ProjectImageEditorV3BundleDocument {
  source: ImageEditProjectPackageDocumentReferenceV3
  envelope: ImageEditDocumentEnvelope
}

export interface ProjectImageEditorV3BundleManifest {
  bundleFormat: typeof PROJECT_IMAGE_EDITOR_V3_BUNDLE_FORMAT
  bundleVersion: typeof PROJECT_IMAGE_EDITOR_V3_BUNDLE_VERSION
  documents: ProjectImageEditorV3BundleDocument[]
  resources: ProjectImageEditorV3BundleResource[]
}

export interface PreparedProjectImageEditorV3Export {
  manifest: ProjectImageEditorV3BundleManifest
  resources: Array<ProjectImageEditorV3BundleResource & { resourceId: ResourceId }>
  lease: ResourceLease
}

export interface StagedProjectImageEditorV3Resource {
  path: string
  filePath: string
  sha256: string
  byteLength: number
}

export interface ProjectImageEditorV3Dependencies {
  documents: ImageEditDocumentRepository
  resources: ContentAddressedResourceStore
  createDocumentId?: () => string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${label} contains unknown fields`)
  }
  if (required.some((key) => !(key in value))) throw new Error(`${label} is missing required fields`)
}

export function projectImageEditorV3ResourcePath(resourceId: ResourceId): string {
  return `${PROJECT_IMAGE_EDITOR_V3_RESOURCE_PREFIX}${parseResourceId(resourceId)}`
}

function parseBundleResource(value: unknown): ProjectImageEditorV3BundleResource {
  if (!isRecord(value)) throw new Error('Invalid project image editor V3 resource')
  exactKeys(value, ['resourceId', 'sha256', 'byteLength', 'path'], ['mediaType'], 'Project image editor V3 resource')
  if (typeof value.resourceId !== 'string') throw new Error('Invalid project image editor V3 resource id')
  const resourceId = value.resourceId as ResourceId
  const hash = parseResourceId(resourceId)
  if (value.sha256 !== hash || typeof value.sha256 !== 'string' || !HASH_PATTERN.test(value.sha256)) {
    throw new Error(`Project image editor V3 resource hash mismatch: ${resourceId}`)
  }
  if (!Number.isSafeInteger(value.byteLength) || Number(value.byteLength) < 0) {
    throw new Error(`Invalid project image editor V3 resource byte length: ${resourceId}`)
  }
  const expectedPath = projectImageEditorV3ResourcePath(resourceId)
  if (value.path !== expectedPath) throw new Error(`Invalid project image editor V3 resource path: ${String(value.path)}`)
  if (value.mediaType !== undefined && (typeof value.mediaType !== 'string' || value.mediaType.length > 256)) {
    throw new Error(`Invalid project image editor V3 resource media type: ${resourceId}`)
  }
  return {
    resourceId,
    sha256: hash,
    byteLength: Number(value.byteLength),
    path: expectedPath,
    ...(value.mediaType ? { mediaType: value.mediaType } : {}),
  }
}

function parseBundleDocument(value: unknown): ProjectImageEditorV3BundleDocument {
  if (!isRecord(value)) throw new Error('Invalid project image editor V3 document')
  exactKeys(value, ['source', 'envelope'], [], 'Project image editor V3 document')
  const source = parseImageEditProjectPackageDocumentReferenceV3(value.source)
  const envelope = validateImageEditDocumentEnvelope(value.envelope)
  if (
    toDocumentRef(envelope.documentId) !== source.documentRef
    || envelope.revision !== source.revision
    || (envelope.previewRef ?? null) !== source.previewRef
  ) {
    throw new Error(`Project image editor V3 document reference mismatch: ${source.documentRef}`)
  }
  return { source, envelope }
}

export function parseProjectImageEditorV3BundleManifest(
  value: unknown,
): ProjectImageEditorV3BundleManifest {
  if (!isRecord(value)) throw new Error('Invalid project image editor V3 bundle manifest')
  exactKeys(value, ['bundleFormat', 'bundleVersion', 'documents', 'resources'], [], 'Project image editor V3 bundle')
  if (
    value.bundleFormat !== PROJECT_IMAGE_EDITOR_V3_BUNDLE_FORMAT
    || value.bundleVersion !== PROJECT_IMAGE_EDITOR_V3_BUNDLE_VERSION
    || !Array.isArray(value.documents)
    || !Array.isArray(value.resources)
  ) {
    throw new Error('Unsupported project image editor V3 bundle')
  }
  const documents = value.documents.map(parseBundleDocument)
  const resources = value.resources.map(parseBundleResource)
  const documentRefs = new Set<string>()
  for (const document of documents) {
    if (documentRefs.has(document.source.documentRef)) {
      throw new Error(`Duplicate project image editor V3 document: ${document.source.documentRef}`)
    }
    documentRefs.add(document.source.documentRef)
  }
  const resourceIds = new Set<ResourceId>()
  for (const resource of resources) {
    if (resourceIds.has(resource.resourceId)) {
      throw new Error(`Duplicate project image editor V3 resource: ${resource.resourceId}`)
    }
    resourceIds.add(resource.resourceId)
  }
  const requiredResourceIds = new Set<ResourceId>()
  for (const document of documents) {
    for (const resourceId of document.envelope.resourceRefs) {
      requiredResourceIds.add(resourceId)
      if (!resourceIds.has(resourceId)) {
        throw new Error(`Project image editor V3 resource missing: ${resourceId}`)
      }
    }
    if (document.envelope.previewRef) {
      requiredResourceIds.add(document.envelope.previewRef)
      if (!resourceIds.has(document.envelope.previewRef)) {
        throw new Error(`Project image editor V3 preview missing: ${document.envelope.previewRef}`)
      }
    }
  }
  for (const resourceId of resourceIds) {
    if (!requiredResourceIds.has(resourceId)) {
      throw new Error(`Unreferenced project image editor V3 resource: ${resourceId}`)
    }
  }
  const resourceBytes = new Map(resources.map((resource) => [resource.resourceId, resource.byteLength]))
  for (const document of documents) {
    for (const historyResource of collectPersistedImageEditHistoryResourcesV3(document.envelope.history)) {
      if (
        historyResource.byteSize !== null
        && resourceBytes.get(historyResource.resourceId as ResourceId) !== historyResource.byteSize
      ) {
        throw new Error(`Project image editor V3 history resource size mismatch: ${historyResource.resourceId}`)
      }
    }
  }
  return {
    bundleFormat: PROJECT_IMAGE_EDITOR_V3_BUNDLE_FORMAT,
    bundleVersion: PROJECT_IMAGE_EDITOR_V3_BUNDLE_VERSION,
    documents,
    resources,
  }
}

function assertExtensionMatchesBundle(
  extension: ImageEditProjectPackageExtensionV3,
  bundle: ProjectImageEditorV3BundleManifest,
): void {
  if (extension.documents.length !== bundle.documents.length) {
    throw new Error('Project image editor V3 document count mismatch')
  }
  const bundled = new Map(bundle.documents.map((document) => [document.source.documentRef, document.source]))
  for (const reference of extension.documents) {
    const actual = bundled.get(reference.documentRef)
    if (
      !actual
      || actual.revision !== reference.revision
      || actual.previewRef !== reference.previewRef
    ) {
      throw new Error(`Project image editor V3 extension mismatch: ${reference.documentRef}`)
    }
  }
}

export async function prepareProjectImageEditorV3Export(
  rawExtension: unknown,
  dependencies: ProjectImageEditorV3Dependencies,
): Promise<PreparedProjectImageEditorV3Export> {
  const extension = parseImageEditProjectPackageExtensionV3(rawExtension)
  const documents: ProjectImageEditorV3BundleDocument[] = []
  const resourceIds = new Set<ResourceId>()
  for (const source of extension.documents) {
    const envelope = await dependencies.documents.load(source.documentRef)
    if (
      envelope.revision !== source.revision
      || (envelope.previewRef ?? null) !== source.previewRef
    ) {
      throw new Error(`Image editor V3 project reference is stale: ${source.documentRef}`)
    }
    documents.push({ source, envelope })
    envelope.resourceRefs.forEach((resourceId) => resourceIds.add(resourceId))
    if (envelope.previewRef) resourceIds.add(envelope.previewRef)
  }
  const lease = await dependencies.resources.acquireLease([...resourceIds])
  try {
    const resources: ProjectImageEditorV3BundleResource[] = []
    for (const resourceId of [...resourceIds].sort()) {
      const descriptor = await dependencies.resources.verify(resourceId)
      resources.push({
        resourceId,
        sha256: descriptor.sha256,
        byteLength: descriptor.byteLength,
        path: projectImageEditorV3ResourcePath(resourceId),
        ...(descriptor.mediaType ? { mediaType: descriptor.mediaType } : {}),
      })
    }
    const resourceBytes = new Map(resources.map((resource) => [resource.resourceId, resource.byteLength]))
    for (const document of documents) {
      for (const historyResource of collectPersistedImageEditHistoryResourcesV3(document.envelope.history)) {
        if (
          historyResource.byteSize !== null
          && resourceBytes.get(historyResource.resourceId as ResourceId) !== historyResource.byteSize
        ) {
          throw new Error(`Project image editor V3 history resource size mismatch: ${historyResource.resourceId}`)
        }
      }
    }
    return {
      manifest: {
        bundleFormat: PROJECT_IMAGE_EDITOR_V3_BUNDLE_FORMAT,
        bundleVersion: PROJECT_IMAGE_EDITOR_V3_BUNDLE_VERSION,
        documents,
        resources,
      },
      resources,
      lease,
    }
  } catch (error) {
    await lease.release()
    throw error
  }
}

function remapEnvelopeDocumentId(
  envelope: ImageEditDocumentEnvelope,
  documentId: string,
): ImageEditDocumentEnvelope {
  if (!DOCUMENT_ID_PATTERN.test(documentId)) throw new Error(`Invalid imported image edit document id: ${documentId}`)
  if (!isRecord(envelope.document)) throw new Error('Invalid imported image edit document body')
  const document = envelope.document
  const history = envelope.history
  return validateImageEditDocumentEnvelope({
    ...envelope,
    documentId,
    document: { ...document, id: documentId },
    ...(history ? { history: { ...history, documentId } } : {}),
  })
}

async function rollbackImportedDocuments(
  documents: readonly ImageEditDocumentEnvelope[],
  repository: ImageEditDocumentRepository,
): Promise<void> {
  for (const document of [...documents].reverse()) {
    await repository.deleteIfRevision(document.documentId, document.revision).catch(() => false)
  }
}

export async function importProjectImageEditorV3Bundle(
  rawExtension: unknown,
  rawManifest: unknown,
  stagedResources: readonly StagedProjectImageEditorV3Resource[],
  dependencies: ProjectImageEditorV3Dependencies,
): Promise<ImageEditProjectPackageReferenceMappingV3[]> {
  const extension = parseImageEditProjectPackageExtensionV3(rawExtension)
  const bundle = parseProjectImageEditorV3BundleManifest(rawManifest)
  assertExtensionMatchesBundle(extension, bundle)
  const stagedByPath = new Map<string, StagedProjectImageEditorV3Resource>()
  for (const staged of stagedResources) {
    if (stagedByPath.has(staged.path)) throw new Error(`Duplicate staged image editor V3 resource: ${staged.path}`)
    stagedByPath.set(staged.path, staged)
  }
  if (stagedByPath.size !== bundle.resources.length) {
    throw new Error('Project image editor V3 staged resource count mismatch')
  }
  for (const resource of bundle.resources) {
    const staged = stagedByPath.get(resource.path)
    if (!staged) throw new Error(`Project image editor V3 resource entry missing: ${resource.path}`)
    if (staged.sha256 !== resource.sha256 || staged.byteLength !== resource.byteLength) {
      throw new Error(`Project image editor V3 resource entry is corrupt: ${resource.path}`)
    }
  }

  const createDocumentId = dependencies.createDocumentId ?? crypto.randomUUID
  const remapped = bundle.documents.map((entry) => ({
    source: entry.source,
    envelope: remapEnvelopeDocumentId(entry.envelope, createDocumentId()),
  }))
  if (new Set(remapped.map((entry) => entry.envelope.documentId)).size !== remapped.length) {
    throw new Error('Imported image editor V3 document ids are not unique')
  }

  const createdResources: ResourceId[] = []
  const createdDocuments: ImageEditDocumentEnvelope[] = []
  let lease: ResourceLease | undefined
  try {
    for (const resource of bundle.resources) {
      const staged = stagedByPath.get(resource.path)
      if (!staged) throw new Error(`Project image editor V3 resource entry missing: ${resource.path}`)
      const stored = await dependencies.resources.putFile(staged.filePath, {
        expectedSha256: resource.sha256,
        mediaType: resource.mediaType,
        maxBytes: resource.byteLength || 1,
      })
      if (stored.byteLength !== resource.byteLength || stored.id !== resource.resourceId) {
        throw new Error(`Project image editor V3 resource import mismatch: ${resource.path}`)
      }
      if (stored.created) createdResources.push(stored.id)
    }
    lease = await dependencies.resources.acquireLease(bundle.resources.map((resource) => resource.resourceId))
    for (const entry of remapped) {
      const envelope = entry.envelope
      const created = await dependencies.documents.create({
        documentId: envelope.documentId,
        revision: envelope.revision,
        document: envelope.document,
        history: envelope.history,
        resourceRefs: envelope.resourceRefs,
        previewRef: envelope.previewRef,
        now: new Date(envelope.updatedAt),
      })
      createdDocuments.push(created)
    }
    return remapped.map((entry) => ({
      source: entry.source,
      imported: {
        documentRef: toDocumentRef(entry.envelope.documentId) as ImageEditProjectPackageDocumentReferenceV3['documentRef'],
        revision: entry.envelope.revision,
        previewRef: entry.envelope.previewRef ?? null,
      },
    }))
  } catch (error) {
    await rollbackImportedDocuments(createdDocuments, dependencies.documents)
    await lease?.release()
    lease = undefined
    await dependencies.resources.discardCreated(createdResources).catch(() => [])
    throw error
  } finally {
    await lease?.release()
  }
}

export function validateProjectImageEditorV3EntryPath(entryPath: string): string {
  if (entryPath === IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3) return entryPath
  if (!entryPath.startsWith(PROJECT_IMAGE_EDITOR_V3_RESOURCE_PREFIX)) {
    throw new Error(`Unsupported project image editor V3 entry: ${entryPath}`)
  }
  const hash = entryPath.slice(PROJECT_IMAGE_EDITOR_V3_RESOURCE_PREFIX.length)
  if (!HASH_PATTERN.test(hash) || entryPath !== `${PROJECT_IMAGE_EDITOR_V3_RESOURCE_PREFIX}${hash}`) {
    throw new Error(`Unsafe project image editor V3 entry: ${entryPath}`)
  }
  return entryPath
}
