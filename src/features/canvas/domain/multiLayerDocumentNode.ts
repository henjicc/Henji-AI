import {
  applicationRefSchema,
  type ApplicationRef,
} from '@/core/application-control'
import {
  parseImageEditSessionReferenceV3,
  type ImageEditSessionReferenceV3,
} from '@/core/imageEdit/v3/sessionReference'

import type { LayerStackResultNodeData } from './canvasNodeData'
import {
  validateLayerStackDocument,
  type LayerStackDocumentV1,
} from './layerStack'

export const MULTI_LAYER_DOCUMENT_NODE_STATES = [
  'generation-placeholder',
  'legacy-v1-pending-migration',
  'editable-v3',
  'degraded',
] as const

export type MultiLayerDocumentNodeStateKind =
  (typeof MULTI_LAYER_DOCUMENT_NODE_STATES)[number]

export type MultiLayerDocumentNodeDegradedReason =
  | 'document-unavailable'
  | 'legacy-resources-unavailable'
  | 'materialized-image-unavailable'
  | 'preview-unavailable'

export type MultiLayerDocumentNodeState =
  | {
      kind: 'generation-placeholder'
      status: 'idle' | 'generating' | 'failed'
    }
  | {
      kind: 'legacy-v1-pending-migration'
      document: LayerStackDocumentV1
      imageUrl: string
      previewImageUrl: string
    }
  | {
      kind: 'editable-v3'
      session: ImageEditSessionReferenceV3
      imageUrl: string
      previewImageUrl: string
      legacyDocument: LayerStackDocumentV1 | null
    }
  | {
      kind: 'degraded'
      reason: MultiLayerDocumentNodeDegradedReason
      session: ImageEditSessionReferenceV3 | null
      legacyDocument: LayerStackDocumentV1 | null
      imageUrl: string | null
      previewImageUrl: string | null
    }

export type MultiLayerDocumentExportTarget =
  | {
      kind: 'raster-layer'
      ref: ApplicationRef & { kind: 'image_edit.layer' }
    }
  | {
      kind: 'layer-group'
      ref: ApplicationRef & { kind: 'image_edit.group' }
    }
  | {
      kind: 'annotation-element'
      ref: ApplicationRef & { kind: 'image_mark.annotation' }
    }

export class MultiLayerDocumentNodeContractError extends Error {
  constructor(
    readonly code:
      | 'INVALID_NODE_STATE'
      | 'INVALID_EXPORT_TARGET'
      | 'UNSUPPORTED_EXPORT_TARGET',
    message: string,
  ) {
    super(message)
    this.name = 'MultiLayerDocumentNodeContractError'
  }
}

function requiredUrl(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function parseLegacyDocument(value: unknown): LayerStackDocumentV1 | null {
  if (value === undefined || value === null) return null
  try {
    return validateLayerStackDocument(value as LayerStackDocumentV1)
  } catch (error) {
    throw new MultiLayerDocumentNodeContractError(
      'INVALID_NODE_STATE',
      error instanceof Error ? `旧版图层文档无效：${error.message}` : '旧版图层文档无效',
    )
  }
}

function parseStrictSession(
  value: unknown,
  imageUrl: string | null,
): ImageEditSessionReferenceV3 | null {
  if (value === undefined || value === null) return null
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || typeof (value as Record<string, unknown>).sourceUrl !== 'string'
    || !(value as Record<string, unknown>).sourceUrl
  ) {
    throw new MultiLayerDocumentNodeContractError(
      'INVALID_NODE_STATE',
      'V3 文档引用必须包含稳定的图片来源',
    )
  }
  try {
    const sourceUrl = (value as Record<string, unknown>).sourceUrl as string
    const session = parseImageEditSessionReferenceV3(value, imageUrl ?? sourceUrl)
    if (!session || (imageUrl !== null && session.sourceUrl !== imageUrl)) {
      throw new TypeError('会话来源与节点图片不一致')
    }
    return session
  } catch (error) {
    throw new MultiLayerDocumentNodeContractError(
      'INVALID_NODE_STATE',
      error instanceof Error ? `V3 文档引用无效：${error.message}` : 'V3 文档引用无效',
    )
  }
}

/**
 * 多图层节点的唯一状态解析器。它不访问 Store 或文档仓库：
 * V3 会话与平面图的结构一致性在这里冻结，资源是否真实存在由 application 服务打开时复核。
 */
export function parseMultiLayerDocumentNodeState(
  data: LayerStackResultNodeData,
): MultiLayerDocumentNodeState {
  if (data.resultKind !== 'layer-stack') {
    throw new MultiLayerDocumentNodeContractError('INVALID_NODE_STATE', '多图层文档节点的结果类型无效')
  }
  const imageUrl = requiredUrl(data.imageUrl)
  const previewImageUrl = requiredUrl(data.previewImageUrl)
  const legacyDocument = parseLegacyDocument(data.layerStackDocument)
  const session = parseStrictSession(data.imageEditSession, imageUrl)

  if (session) {
    if (!imageUrl) {
      return {
        kind: 'degraded',
        reason: 'materialized-image-unavailable',
        session,
        legacyDocument,
        imageUrl: null,
        previewImageUrl,
      }
    }
    if (!previewImageUrl) {
      return {
        kind: 'degraded',
        reason: 'preview-unavailable',
        session,
        legacyDocument,
        imageUrl,
        previewImageUrl: null,
      }
    }
    return {
      kind: 'editable-v3',
      session,
      imageUrl: imageUrl as string,
      previewImageUrl,
      legacyDocument,
    }
  }

  if (legacyDocument) {
    if (legacyDocument.status === 'degraded' || !imageUrl || !previewImageUrl) {
      return {
        kind: 'degraded',
        reason: 'legacy-resources-unavailable',
        session: null,
        legacyDocument,
        imageUrl,
        previewImageUrl,
      }
    }
    return {
      kind: 'legacy-v1-pending-migration',
      document: legacyDocument,
      imageUrl,
      previewImageUrl,
    }
  }

  if (!imageUrl && !previewImageUrl) {
    return {
      kind: 'generation-placeholder',
      status: data.isGenerating
        ? 'generating'
        : requiredUrl(data.generationError)
          ? 'failed'
          : 'idle',
    }
  }
  if (!imageUrl && previewImageUrl) {
    throw new MultiLayerDocumentNodeContractError(
      'INVALID_NODE_STATE',
      '节点不能只保存预览图而没有物化图片',
    )
  }
  return {
    kind: 'degraded',
    reason: imageUrl ? 'document-unavailable' : 'materialized-image-unavailable',
    session: null,
    legacyDocument: null,
    imageUrl,
    previewImageUrl,
  }
}

function parseRef(value: unknown): ApplicationRef {
  const parsed = applicationRefSchema.safeParse(value)
  if (!parsed.success) {
    throw new MultiLayerDocumentNodeContractError('INVALID_EXPORT_TARGET', '独立导出目标引用无效')
  }
  return parsed.data
}

/** 只接收已冻结的三种导出目标；上下文效果层必须显式拒绝。 */
export function parseMultiLayerDocumentExportTarget(
  value: unknown,
): MultiLayerDocumentExportTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MultiLayerDocumentNodeContractError('INVALID_EXPORT_TARGET', '独立导出目标无效')
  }
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'effect-layer' || candidate.kind === 'adjustment-layer') {
    throw new MultiLayerDocumentNodeContractError(
      'UNSUPPORTED_EXPORT_TARGET',
      candidate.kind === 'effect-layer'
        ? '效果层依赖下方图层上下文，暂不支持单独导出'
        : '调整层依赖下方图层上下文，暂不支持单独导出',
    )
  }
  const ref = parseRef(candidate.ref)
  if (candidate.kind === 'raster-layer' && ref.kind === 'image_edit.layer') {
    return { kind: 'raster-layer', ref: ref as ApplicationRef & { kind: 'image_edit.layer' } }
  }
  if (candidate.kind === 'layer-group' && ref.kind === 'image_edit.group') {
    return { kind: 'layer-group', ref: ref as ApplicationRef & { kind: 'image_edit.group' } }
  }
  if (candidate.kind === 'annotation-element' && ref.kind === 'image_mark.annotation') {
    return { kind: 'annotation-element', ref: ref as ApplicationRef & { kind: 'image_mark.annotation' } }
  }
  throw new MultiLayerDocumentNodeContractError(
    'INVALID_EXPORT_TARGET',
    '独立导出目标类型与稳定引用不一致',
  )
}

export function isEditableMultiLayerDocumentNode(
  data: LayerStackResultNodeData,
): boolean {
  try {
    return parseMultiLayerDocumentNodeState(data).kind === 'editable-v3'
  } catch {
    return false
  }
}
