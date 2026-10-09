import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'

export interface ImageEditPreviewSnapshot {
  previewRef: string
  sourceRef: string
  document: ImageEditDocumentV3
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
  previews.set(preview.previewRef, preview)
}

export function getStoredImageEditPreview(previewRef: string): StoredImageEditPreview | null {
  return previews.get(previewRef) ?? null
}

/** 预览是创建能力产生的不可变快照；继续编辑会创建另一份 V3 文档。 */
export function isImageEditPreviewDocument(documentId: string): boolean {
  for (const preview of previews.values()) if (preview.document.id === documentId) return true
  return false
}

export function deleteStoredImageEditPreview(previewRef: string): void {
  previews.delete(previewRef)
}

export function* iterateImageEditPreviewReferences(): Iterable<{ previewRef: string; revision: number }> {
  for (const preview of previews.values()) yield { previewRef: preview.previewRef, revision: preview.revision }
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
