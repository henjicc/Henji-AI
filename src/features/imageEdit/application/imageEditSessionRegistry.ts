import type { ImageEditDocument } from '@/core/imageEdit'

const MAX_PREVIEWS = 64

export interface ImageEditPreviewSnapshot {
  previewRef: string
  sourceRef: string
  document: ImageEditDocument
  width: number
  height: number
  revision: number
  createdAt: number
}

export interface StoredImageEditPreview extends ImageEditPreviewSnapshot {
  source: string
}

const previews = new Map<string, StoredImageEditPreview>()

export function storeImageEditPreview(preview: StoredImageEditPreview): void {
  while (previews.size >= MAX_PREVIEWS) {
    const oldestRef = previews.keys().next().value
    if (typeof oldestRef !== 'string') break
    previews.delete(oldestRef)
  }
  previews.set(preview.previewRef, preview)
}

export function getStoredImageEditPreview(previewRef: string): StoredImageEditPreview | null {
  return previews.get(previewRef) ?? null
}

export function deleteStoredImageEditPreview(previewRef: string): void {
  previews.delete(previewRef)
}

export function listImageEditPreviews(): ImageEditPreviewSnapshot[] {
  return [...previews.values()].map(({ source: _source, ...preview }) => structuredClone(preview))
}

export function readImageEditPreview(previewRef: string): ImageEditPreviewSnapshot | null {
  const preview = previews.get(previewRef)
  if (!preview) return null
  const { source: _source, ...snapshot } = preview
  return structuredClone(snapshot)
}

export function resetImageEditSessionRegistryForTests(): void {
  previews.clear()
}
