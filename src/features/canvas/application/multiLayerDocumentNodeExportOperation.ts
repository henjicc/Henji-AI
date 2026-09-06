import { createLogger } from '@/core/logging'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import { splitImageEditV3AnnotationRef, splitImageEditV3LayerRef } from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'
import { parseMultiLayerDocumentExportTarget, type MultiLayerDocumentExportTarget } from '../domain/multiLayerDocumentNode'
import { MultiLayerDocumentNodeApplicationError, type MultiLayerDocumentExportRaster, type MultiLayerDocumentNodeApplicationService, type MultiLayerDocumentNodeCanvasPort, type MultiLayerDocumentNodePort } from './multiLayerDocumentNodeApplicationContracts'
import { retainsCanvasMutation } from './canvasPersistenceService'

const logger = createLogger('features.canvas.multi_layer_document_node')

function validateRaster(raster: MultiLayerDocumentExportRaster): MultiLayerDocumentExportRaster {
  if (
    !raster.imageUrl.trim()
    || !raster.previewImageUrl.trim()
    || !raster.aspectRatio.trim()
    || !Number.isInteger(raster.width)
    || raster.width < 1
    || !Number.isInteger(raster.height)
    || raster.height < 1
    || raster.mediaType !== 'image/png'
    || raster.hasAlpha !== true
    || !raster.displayName.trim()
    || !Array.isArray(raster.ownedFilePaths)
    || raster.ownedFilePaths.some((filePath) => typeof filePath !== 'string' || !filePath.trim())
    || !raster.diagnostics
    || raster.diagnostics.canvasScope !== 'document'
    || !raster.diagnostics.documentId.trim()
    || !Number.isInteger(raster.diagnostics.revision)
    || !raster.diagnostics.targetId.trim()
    || !Array.isArray(raster.diagnostics.layerPath)
  ) {
    throw new MultiLayerDocumentNodeApplicationError('OPERATION_FAILED', '独立导出没有产生完整的受管图片', true)
  }
  return raster
}

function targetDocumentId(target: MultiLayerDocumentExportTarget): string {
  if (target.kind === 'layer-group') {
    return splitImageEditV3LayerRef(target.ref, 'image_edit.group').documentId
  }
  if (target.kind === 'annotation-element') {
    return splitImageEditV3AnnotationRef(target.ref).documentId
  }
  return splitImageEditV3LayerRef(target.ref).documentId
}

function documentId(session: ImageEditSessionReferenceV3): string {
  return session.documentRef.slice('image-edit-v3:'.length)
}

function resolveExportSession(
  saved: ImageEditSessionReferenceV3,
  current: ImageEditSessionReferenceV3 | undefined,
): ImageEditSessionReferenceV3 {
  if (!current) return saved
  if (current.kind !== saved.kind || current.documentRef !== saved.documentRef) {
    throw new MultiLayerDocumentNodeApplicationError(
      'DOCUMENT_CONFLICT',
      '当前编辑会话不属于这个多图层文档节点',
      true,
    )
  }
  if (current.revision < saved.revision) {
    throw new MultiLayerDocumentNodeApplicationError(
      'DOCUMENT_CONFLICT',
      '当前编辑会话版本早于画布节点，请重新打开后再试',
      true,
    )
  }
  return current
}

/** 像素导出与画布接管同一生命周期；未确认持久化时不能释放活节点正在引用的资源。 */
export async function exportMultiLayerDocumentRaster(
  dependencies: { documentPort: MultiLayerDocumentNodePort; canvasPort: MultiLayerDocumentNodeCanvasPort },
  input: Parameters<MultiLayerDocumentNodeApplicationService['exportTarget']>[0],
  saved: ImageEditSessionReferenceV3,
) {
  const session = resolveExportSession(saved, input.session)
  const target = parseMultiLayerDocumentExportTarget(input.target)
  let targetDocument: string
  try {
    targetDocument = targetDocumentId(target)
  } catch (error) {
    throw new MultiLayerDocumentNodeApplicationError(
      'INVALID_INPUT',
      '独立导出目标不是有效的 V3 文档引用',
      false,
      { cause: error },
    )
  }
  if (targetDocument !== documentId(session)) {
    throw new MultiLayerDocumentNodeApplicationError(
      'INVALID_INPUT',
      '独立导出目标不属于当前节点文档',
      false,
    )
  }
  const raster = validateRaster(await dependencies.documentPort.materializeExportTarget({
    session,
    target,
    signal: input.signal,
  }))
  try {
    const created = await dependencies.canvasPort.createExportedImageNode({
      projectId: input.projectId,
      sourceNodeId: input.sourceNodeId,
      target,
      raster,
    })
    if (!created.nodeId.trim() || !created.edgeId.trim() || !created.undoRef.trim()) {
      throw new MultiLayerDocumentNodeApplicationError(
        'OPERATION_FAILED',
        '独立导出未创建完整的图片节点和连线',
        true,
      )
    }
    return { ...created, raster }
  } catch (error) {
    if (retainsCanvasMutation(error)) throw error
    await dependencies.documentPort.releaseExportRaster({ raster }).catch((releaseError) => {
      logger.error('独立导出像素资源补偿失败', releaseError, {
        event: 'canvas.multi_layer_document.export_target.rollback.failed',
        nodeId: input.sourceNodeId,
      })
    })
    throw error
  }
}
