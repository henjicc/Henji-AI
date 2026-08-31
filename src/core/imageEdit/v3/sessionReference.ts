import { coerceImageEditSession } from '../legacy'
import type { ImageEditSession } from '../types'

export type ImageEditDocumentRefV3 = `image-edit-v3:${string}`
export type ImageEditPreviewRefV3 = `sha256:${string}`

/**
 * 查看器等轻宿主只跨边界保存受管文档引用，不复制 V3 文档或完整像素。
 * 文档与历史的唯一持久化真相仍由 ImageEditorV3DocumentRepository 维护。
 */
export interface ImageEditSessionReferenceV3 {
  kind: 'image-edit-v3'
  sourceUrl: string
  documentRef: ImageEditDocumentRefV3
  revision: number
  previewRef: ImageEditPreviewRefV3 | null
}

export type ImageEditSessionData = ImageEditSession | ImageEditSessionReferenceV3

const DOCUMENT_REF_PATTERN = /^image-edit-v3:[A-Za-z0-9_-]{1,128}$/
const PREVIEW_REF_PATTERN = /^sha256:[a-f0-9]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseImageEditSessionReferenceV3(
  value: unknown,
  fallbackSourceUrl: string,
): ImageEditSessionReferenceV3 | null {
  if (!isRecord(value) || value.kind !== 'image-edit-v3') return null
  if (
    typeof value.documentRef !== 'string'
    || !DOCUMENT_REF_PATTERN.test(value.documentRef)
    || !Number.isSafeInteger(value.revision)
    || Number(value.revision) < 0
    || (value.previewRef !== null && (
      typeof value.previewRef !== 'string' || !PREVIEW_REF_PATTERN.test(value.previewRef)
    ))
  ) {
    throw new TypeError('图片编辑 V3 会话引用无效')
  }
  return {
    kind: 'image-edit-v3',
    sourceUrl: typeof value.sourceUrl === 'string' && value.sourceUrl
      ? value.sourceUrl
      : fallbackSourceUrl,
    documentRef: value.documentRef as ImageEditDocumentRefV3,
    revision: Number(value.revision),
    previewRef: value.previewRef as ImageEditPreviewRefV3 | null,
  }
}

export function isImageEditSessionReferenceV3(
  value: unknown,
): value is ImageEditSessionReferenceV3 {
  try {
    return parseImageEditSessionReferenceV3(value, '') !== null
  } catch {
    return false
  }
}

/** 保留 V3 受管引用；其余存量格式继续交给既有 V2 兼容解码器。 */
export function coerceImageEditSessionData(
  value: unknown,
  fallbackSourceUrl: string,
): ImageEditSessionData {
  const v3 = parseImageEditSessionReferenceV3(value, fallbackSourceUrl)
  return v3 ?? coerceImageEditSession(value, fallbackSourceUrl)
}
