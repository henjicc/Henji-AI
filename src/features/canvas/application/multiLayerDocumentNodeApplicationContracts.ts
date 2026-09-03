import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'

import type { LayerStackResultNodeData } from '../domain/canvasNodeData'
import type { LayerStackDocumentV1 } from '../domain/layerStack'
import type { MultiLayerDocumentExportTarget } from '../domain/multiLayerDocumentNode'

export const MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY = 'skip-canvas-history' as const

export type MultiLayerDocumentNodeApplicationErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_NODE_STATE'
  | 'MIGRATION_REQUIRED'
  | 'DOCUMENT_NOT_FOUND'
  | 'DOCUMENT_CONFLICT'
  | 'UNSUPPORTED_EXPORT_TARGET'
  | 'CANCELLED'
  | 'OPERATION_FAILED'

export class MultiLayerDocumentNodeApplicationError extends Error {
  constructor(
    readonly code: MultiLayerDocumentNodeApplicationErrorCode,
    message: string,
    readonly recoverable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MultiLayerDocumentNodeApplicationError'
  }
}

export interface MultiLayerDocumentNodeProjection {
  imageEditSession: ImageEditSessionReferenceV3
  imageUrl: string
  previewImageUrl: string
  aspectRatio: string
}

export interface MultiLayerDocumentExportRaster {
  imageUrl: string
  previewImageUrl: string
  aspectRatio: string
  width: number
  height: number
  mediaType: 'image/png'
  hasAlpha: true
  displayName: string
  /** 画布事务失败时由 releaseExportRaster 补偿；禁止写入日志或正式 UI。 */
  ownedFilePaths: string[]
  diagnostics: {
    documentId: string
    revision: number
    targetKind: MultiLayerDocumentExportTarget['kind']
    targetId: string
    layerPath: readonly string[]
    canvasScope: 'document'
    contentState: 'rendered' | 'hidden' | 'empty'
  }
}

/** 宿主文档、资源与像素能力的窄端口；不暴露主进程仓库对象。 */
export interface MultiLayerDocumentNodePort {
  createFromLayerStack(input: {
    nodeId: string
    document: LayerStackDocumentV1
    signal?: AbortSignal
  }): Promise<MultiLayerDocumentNodeProjection>
  inspectDocument(input: {
    session: ImageEditSessionReferenceV3
    signal?: AbortSignal
  }): Promise<ImageEditSessionReferenceV3>
  saveAndMaterialize(input: {
    session: ImageEditSessionReferenceV3
    signal?: AbortSignal
  }): Promise<MultiLayerDocumentNodeProjection>
  forkDocument(input: {
    sourceNodeId: string
    targetNodeId: string
    session: ImageEditSessionReferenceV3
    signal?: AbortSignal
  }): Promise<MultiLayerDocumentNodeProjection>
  markReleaseCandidate(input: {
    nodeId: string
    session: ImageEditSessionReferenceV3
    signal?: AbortSignal
  }): Promise<void>
  materializeExportTarget(input: {
    session: ImageEditSessionReferenceV3
    target: MultiLayerDocumentExportTarget
    signal?: AbortSignal
  }): Promise<MultiLayerDocumentExportRaster>
  /** 独立导出的画布事务未接管像素资源时，补偿本次新建的受管图片。 */
  releaseExportRaster(input: {
    raster: MultiLayerDocumentExportRaster
  }): Promise<void>
}

/** 画布事务的窄端口；实现者负责节点原位投影或新建普通图片节点。 */
export interface MultiLayerDocumentNodeCanvasPort {
  commitMaterializedProjection(input: {
    projectId: string
    nodeId: string
    projection: MultiLayerDocumentNodeProjection
    /**
     * V3 命令已进入文档历史；这次写回只是同一编辑语义的节点投影同步，
     * 不得再新增一条可撤销的画布历史。
     */
    historyPolicy: typeof MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY
  }): Promise<void>
  createExportedImageNode(input: {
    projectId: string
    sourceNodeId: string
    target: MultiLayerDocumentExportTarget
    raster: MultiLayerDocumentExportRaster
  }): Promise<{ nodeId: string; edgeId: string }>
}

export interface MultiLayerDocumentNodeApplicationService {
  createFromLayerStack(input: {
    nodeId: string
    document: LayerStackDocumentV1
    signal?: AbortSignal
  }): Promise<MultiLayerDocumentNodeProjection>
  openAndValidate(input: {
    nodeId: string
    data: LayerStackResultNodeData
    signal?: AbortSignal
  }): Promise<ImageEditSessionReferenceV3>
  saveMaterializedProjection(input: {
    projectId: string
    nodeId: string
    data: LayerStackResultNodeData
    signal?: AbortSignal
  }): Promise<MultiLayerDocumentNodeProjection>
  forkDocument(input: {
    sourceNodeId: string
    targetNodeId: string
    data: LayerStackResultNodeData
    signal?: AbortSignal
  }): Promise<MultiLayerDocumentNodeProjection>
  markReleaseCandidate(input: {
    nodeId: string
    data: LayerStackResultNodeData
    signal?: AbortSignal
  }): Promise<void>
  exportTarget(input: {
    projectId: string
    sourceNodeId: string
    data: LayerStackResultNodeData
    target: unknown
    signal?: AbortSignal
  }): Promise<{ nodeId: string; edgeId: string; raster: MultiLayerDocumentExportRaster }>
}
