import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import type { ImageEditorV3ResourceRef } from '@/platform/contracts/imageEditorV3'

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

/**
 * 整图物化已经把新 previewRef 原子挂到 V3 文档，但画布节点尚未完成 CAS 接管。
 * rollback 仅供 application 服务在画布提交失败时精确恢复旧 previewRef。
 */
export interface MultiLayerDocumentNodeMaterialization {
  projection: MultiLayerDocumentNodeProjection
  rollback: {
    documentRef: ImageEditSessionReferenceV3['documentRef']
    revision: number
    sourceFingerprint: `sha256:${string}`
    previousPreviewRef: ImageEditorV3ResourceRef | null
    installedPreviewRef: ImageEditorV3ResourceRef
  }
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
  }): Promise<MultiLayerDocumentNodeMaterialization>
  /** 画布 CAS 未接管新投影时，只有文档仍精确指向本次 previewRef 才允许恢复。 */
  rollbackMaterialization(input: {
    materialization: MultiLayerDocumentNodeMaterialization
  }): Promise<boolean>
  /** CAS 已接管新投影后，从文档资源集合移除被替换的旧 previewRef；失败不得回滚提交。 */
  finalizeMaterialization(input: {
    materialization: MultiLayerDocumentNodeMaterialization
  }): Promise<boolean>
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
    expectedSession: ImageEditSessionReferenceV3
    projection: MultiLayerDocumentNodeProjection
    /**
     * V3 命令已进入文档历史；这次写回只是同一编辑语义的节点投影同步，
     * 不得再新增一条可撤销的画布历史。
     */
    historyPolicy: typeof MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY
  }): Promise<void>
  commitLegacyMigration(input: {
    projectId: string
    nodeId: string
    expectedDocument: LayerStackDocumentV1
    projection: MultiLayerDocumentNodeProjection
    historyPolicy: typeof MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY
  }): Promise<'committed' | 'already-committed'>
  createExportedImageNode(input: {
    projectId: string
    sourceNodeId: string
    target: MultiLayerDocumentExportTarget
    raster: MultiLayerDocumentExportRaster
  }): Promise<{ nodeId: string; edgeId: string; undoRef: string }>
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
  migrateLegacyDocument(input: {
    projectId: string
    nodeId: string
    data: LayerStackResultNodeData
    signal?: AbortSignal
  }): Promise<MultiLayerDocumentNodeProjection>
  saveMaterializedProjection(input: {
    projectId: string
    nodeId: string
    data: LayerStackResultNodeData
    /** 2.1 保存队列 flush 后返回的精确权威 revision。 */
    session: ImageEditSessionReferenceV3
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
    /** 编辑器实时保存后返回的精确会话；未打开编辑器时沿用节点投影。 */
    session?: ImageEditSessionReferenceV3
    target: unknown
    signal?: AbortSignal
  }): Promise<{ nodeId: string; edgeId: string; undoRef: string; raster: MultiLayerDocumentExportRaster }>
}
