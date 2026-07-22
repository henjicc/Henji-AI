import {
  compactPromptMediaReferenceSpacing,
  createLegacyPromptMediaLabels,
  createPromptMediaLabel,
  readPromptDocument,
  type PromptDocumentV1,
  type PromptMediaBinding,
} from '@/core/inputs/promptDocument'

export interface MediaGeneratorPromptImage {
  resourceId: string
  url: string
}

export interface MediaGeneratorPromptReference {
  resourceId: string
  mediaType: 'image'
  label: string
  legacyLabels: readonly string[]
  thumbnailSrc: string
}

export interface MediaGeneratorPromptCarrier {
  document?: unknown
  legacyText: string
  bindings?: unknown
  legacyImages?: unknown
}

export interface ResolvedMediaGeneratorPromptCarrier {
  document: PromptDocumentV1
  images: MediaGeneratorPromptImage[]
}

type ResourceIdFactory = () => string

function defaultResourceIdFactory(): string {
  return `generation-upload:${globalThis.crypto.randomUUID()}`
}

function createPromptImage(url: string, createResourceId: ResourceIdFactory): MediaGeneratorPromptImage {
  return { resourceId: createResourceId(), url }
}

export function reconcileMediaGeneratorPromptImages(
  current: readonly MediaGeneratorPromptImage[],
  nextUrls: readonly string[],
  createResourceId: ResourceIdFactory = defaultResourceIdFactory,
): MediaGeneratorPromptImage[] {
  const availableByUrl = new Map<string, MediaGeneratorPromptImage[]>()
  current.forEach((image) => {
    const available = availableByUrl.get(image.url) ?? []
    available.push(image)
    availableByUrl.set(image.url, available)
  })

  return nextUrls.map((url) => {
    const available = availableByUrl.get(url)
    return available?.shift() ?? createPromptImage(url, createResourceId)
  })
}

export function createMediaGeneratorPromptReferences(
  images: readonly MediaGeneratorPromptImage[],
): MediaGeneratorPromptReference[] {
  return images.map((image, index) => ({
    resourceId: image.resourceId,
    mediaType: 'image',
    label: createPromptMediaLabel('image', index + 1),
    legacyLabels: createLegacyPromptMediaLabels('image', index + 1),
    thumbnailSrc: image.url,
  }))
}

export function createMediaGeneratorPromptBindings(
  images: readonly MediaGeneratorPromptImage[],
  filePaths: readonly string[],
): PromptMediaBinding[] {
  return images.map((image, index) => ({
    resourceId: image.resourceId,
    mediaType: 'image',
    dataUrl: image.url,
    ...(filePaths[index] ? { filePath: filePaths[index] } : {}),
  }))
}

export function resolveMediaGeneratorPromptCarrier(
  carrier: MediaGeneratorPromptCarrier,
  createResourceId: ResourceIdFactory = defaultResourceIdFactory,
): ResolvedMediaGeneratorPromptCarrier {
  const bindings = Array.isArray(carrier.bindings)
    ? carrier.bindings.filter((binding): binding is PromptMediaBinding => (
      Boolean(binding)
      && typeof binding === 'object'
      && typeof binding.resourceId === 'string'
      && binding.mediaType === 'image'
      && typeof binding.dataUrl === 'string'
    ))
    : []
  const legacyImages = Array.isArray(carrier.legacyImages)
    ? carrier.legacyImages.filter((image): image is string => typeof image === 'string')
    : []
  const boundImages = bindings
    .map((binding) => ({
      resourceId: binding.resourceId,
      url: binding.dataUrl ?? '',
    }))
  const images = boundImages.length > 0
    ? boundImages
    : reconcileMediaGeneratorPromptImages([], legacyImages, createResourceId)
  const references = createMediaGeneratorPromptReferences(images)
  const { document } = readPromptDocument(
    { document: carrier.document, legacyText: carrier.legacyText },
    {
      carrierType: 'generation-workspace',
      references,
    },
  )

  return { document: compactPromptMediaReferenceSpacing(document), images }
}
