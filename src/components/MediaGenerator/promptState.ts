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
  // 先认同一位置、同一网址的图，再按网址认挪了位置的图（同一文件导入过两次时不把位置认错）
  const kept: Array<MediaGeneratorPromptImage | undefined> = nextUrls.map((url, index) => (current[index]?.url === url ? current[index] : undefined))
  const keptSet = new Set(kept.filter((image): image is MediaGeneratorPromptImage => Boolean(image)))
  const availableByUrl = new Map<string, MediaGeneratorPromptImage[]>()
  current.forEach((image) => {
    if (keptSet.has(image)) return
    const available = availableByUrl.get(image.url) ?? []
    available.push(image)
    availableByUrl.set(image.url, available)
  })
  nextUrls.forEach((url, index) => { kept[index] ??= availableByUrl.get(url)?.shift() })
  const dropped = new Set(Array.from(availableByUrl.values()).flat())
  // 同一位置换了新图（素材条替换、查看器编辑后保存、生成前把临时图存盘）沿用原图身份，
  // 提示词里引用它的地方跟着指向新图，不因网址变了而失效
  return nextUrls.map((url, index) => {
    const image = kept[index]
    if (image) return image
    const replaced = current[index]
    if (replaced && dropped.delete(replaced)) return { resourceId: replaced.resourceId, url }
    return createPromptImage(url, createResourceId)
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

/**
 * 参考图删掉后，提示词里指向它的引用改指现在排在同一位置的那张图：“图片1”删掉后引用落到新的图片1上。
 * 同一文件导入过两次、删掉其中一张时，引用指向留下的那张（两张是同一个文件，只按网址分不出删的是哪张）。
 * 同一位置已经没有图（删的是最后一张）时不改，引用标成失效。
 */
export function remapRemovedPromptImages(
  before: readonly MediaGeneratorPromptImage[],
  after: readonly MediaGeneratorPromptImage[],
): Map<string, string> {
  const remaining = new Set(after.map((image) => image.resourceId))
  const remap = new Map<string, string>()
  before.forEach((image, index) => {
    if (remaining.has(image.resourceId)) return
    const successor = after.find((candidate) => candidate.url === image.url) ?? after[index]
    if (successor) remap.set(image.resourceId, successor.resourceId)
  })
  return remap
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
