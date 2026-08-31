export type ProjectPackageImageEditDocumentRefV3 = `image-edit-v3:${string}`
export type ProjectPackageImageEditPreviewRefV3 = `sha256:${string}`

export const IMAGE_EDIT_PROJECT_PACKAGE_EXTENSION_VERSION_V3 = 1 as const
export const IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3 = 'image-editor-v3/manifest.json' as const

export interface ImageEditProjectPackageDocumentReferenceV3 {
  documentRef: ProjectPackageImageEditDocumentRefV3
  revision: number
  previewRef: ProjectPackageImageEditPreviewRefV3 | null
}

export interface ImageEditProjectPackageExtensionV3 {
  version: typeof IMAGE_EDIT_PROJECT_PACKAGE_EXTENSION_VERSION_V3
  bundlePath: typeof IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3
  documents: ImageEditProjectPackageDocumentReferenceV3[]
}

export interface ImageEditProjectPackageReferenceMappingV3 {
  source: ImageEditProjectPackageDocumentReferenceV3
  imported: ImageEditProjectPackageDocumentReferenceV3
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const DOCUMENT_REF_PATTERN = /^image-edit-v3:[A-Za-z0-9_-]{1,128}$/
const PREVIEW_REF_PATTERN = /^sha256:[a-f0-9]{64}$/

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const allowed = new Set(keys)
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TypeError(`${label} contains unknown fields`)
  }
  if (keys.some((key) => !(key in value))) {
    throw new TypeError(`${label} is missing required fields`)
  }
}

export function parseImageEditProjectPackageDocumentReferenceV3(
  value: unknown,
): ImageEditProjectPackageDocumentReferenceV3 {
  if (!isRecord(value)) throw new TypeError('Invalid image editor V3 project reference')
  exactKeys(value, ['documentRef', 'revision', 'previewRef'], 'Image editor V3 project reference')
  if (
    typeof value.documentRef !== 'string'
    || !DOCUMENT_REF_PATTERN.test(value.documentRef)
    || !Number.isSafeInteger(value.revision)
    || Number(value.revision) < 0
    || (value.previewRef !== null && (
      typeof value.previewRef !== 'string' || !PREVIEW_REF_PATTERN.test(value.previewRef)
    ))
  ) throw new TypeError('Invalid image editor V3 project reference')
  return {
    documentRef: value.documentRef as ProjectPackageImageEditDocumentRefV3,
    revision: Number(value.revision),
    previewRef: value.previewRef as ProjectPackageImageEditPreviewRefV3 | null,
  }
}

function assertUniqueDocumentReferences(
  documents: readonly ImageEditProjectPackageDocumentReferenceV3[],
  label: string,
): void {
  const seen = new Set<ProjectPackageImageEditDocumentRefV3>()
  for (const document of documents) {
    if (seen.has(document.documentRef)) {
      throw new TypeError(`Duplicate ${label} document reference: ${document.documentRef}`)
    }
    seen.add(document.documentRef)
  }
}

export function parseImageEditProjectPackageExtensionV3(
  value: unknown,
): ImageEditProjectPackageExtensionV3 {
  if (!isRecord(value)) throw new TypeError('Invalid image editor V3 project package extension')
  exactKeys(value, ['version', 'bundlePath', 'documents'], 'Image editor V3 project package extension')
  if (
    value.version !== IMAGE_EDIT_PROJECT_PACKAGE_EXTENSION_VERSION_V3
    || value.bundlePath !== IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3
    || !Array.isArray(value.documents)
  ) {
    throw new TypeError('Unsupported image editor V3 project package extension')
  }
  const documents = value.documents.map(parseImageEditProjectPackageDocumentReferenceV3)
  assertUniqueDocumentReferences(documents, 'project package')
  return {
    version: IMAGE_EDIT_PROJECT_PACKAGE_EXTENSION_VERSION_V3,
    bundlePath: IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
    documents,
  }
}

export function parseImageEditProjectPackageReferenceMappingsV3(
  value: unknown,
): ImageEditProjectPackageReferenceMappingV3[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid image editor V3 project import mappings')
  const mappings = value.map((entry) => {
    if (!isRecord(entry)) throw new TypeError('Invalid image editor V3 project import mapping')
    exactKeys(entry, ['source', 'imported'], 'Image editor V3 project import mapping')
    return {
      source: parseImageEditProjectPackageDocumentReferenceV3(entry.source),
      imported: parseImageEditProjectPackageDocumentReferenceV3(entry.imported),
    }
  })
  assertUniqueDocumentReferences(mappings.map((mapping) => mapping.source), 'source mapping')
  assertUniqueDocumentReferences(mappings.map((mapping) => mapping.imported), 'imported mapping')
  return mappings
}

export function toImageEditProjectPackageDocumentReferenceV3(
  session: ImageEditProjectPackageDocumentReferenceV3,
): ImageEditProjectPackageDocumentReferenceV3 {
  return {
    documentRef: session.documentRef,
    revision: session.revision,
    previewRef: session.previewRef,
  }
}
