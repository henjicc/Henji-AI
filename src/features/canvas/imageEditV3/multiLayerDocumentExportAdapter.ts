import {
  createImageEditorV3RequestId,
  loadImageEditorV3Document,
} from '@/commands/imageEditorV3'
import { materializeImageEditorV3StandaloneRaster } from '@/commands/imageEditorV3Export'
import {
  collectImageEditJsonResourceIdsV3,
  createImageEditExportTargetViewV3,
  ImageEditExportTargetErrorV3,
  type ImageEditExportTargetV3,
  type ImageEditExportTargetViewV3,
} from '@/core/imageEdit/v3'
import {
  splitImageEditV3AnnotationRef,
  splitImageEditV3LayerRef,
} from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'
import {
  prepareImageEditorV3ExportRender,
  renderImageEditorV3ExportTiles,
} from '@/features/imageEdit/v3/export'
import { createImageMarkV3RasterExportSpec } from '@/features/imageMark/standalone/imageMarkV3RasterExport'
import { getPlatform } from '@/platform/runtime'

import type { MultiLayerDocumentExportTarget } from '../domain/multiLayerDocumentNode'
import {
  MultiLayerDocumentNodeApplicationError,
  type MultiLayerDocumentExportRaster,
  type MultiLayerDocumentNodePort,
} from '../application/multiLayerDocumentNodeApplicationContracts'

const EXPORT_TILE_SIZE = 512

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = signal.reason instanceof Error ? signal.reason : new Error('独立图层导出已取消')
  if (error.name === 'Error') error.name = 'AbortError'
  throw error
}

interface AdapterDependencies {
  loadDocument?: typeof loadImageEditorV3Document
  materialize?: typeof materializeImageEditorV3StandaloneRaster
  releaseManagedImages?: (filePaths: string[]) => Promise<void>
}

export type MultiLayerDocumentExportPort = Pick<
  MultiLayerDocumentNodePort,
  'materializeExportTarget' | 'releaseExportRaster'
>

function documentIdFromRef(documentRef: string): string {
  return documentRef.slice('image-edit-v3:'.length)
}

function toCoreTarget(target: MultiLayerDocumentExportTarget): ImageEditExportTargetV3 {
  if (target.kind === 'layer-group') {
    const { layerId } = splitImageEditV3LayerRef(target.ref, 'image_edit.group')
    return { kind: target.kind, layerId }
  }
  if (target.kind === 'annotation-element') {
    const { layerId, annotationId } = splitImageEditV3AnnotationRef(target.ref)
    return { kind: target.kind, layerId, annotationId }
  }
  const { layerId } = splitImageEditV3LayerRef(target.ref)
  return { kind: target.kind, layerId }
}

function aspectRatio(width: number, height: number): string {
  let left = width
  let right = height
  while (right !== 0) [left, right] = [right, left % right]
  return `${width / left}:${height / left}`
}

function pngFormat(bitDepth: 8 | 16 | 'float16' | 'float32'): 'png8' | 'png16' {
  if (bitDepth === 8) return 'png8'
  if (bitDepth === 16) return 'png16'
  throw new MultiLayerDocumentNodeApplicationError(
    'UNSUPPORTED_EXPORT_TARGET',
    '浮点或 HDR 文档无法在不损失颜色的前提下导出为 PNG',
    false,
  )
}

function assertResourcesAvailable(
  document: Parameters<typeof collectImageEditJsonResourceIdsV3>[0],
  available: ReadonlySet<string>,
): void {
  const missing = collectImageEditJsonResourceIdsV3(document).filter((resourceId) => !available.has(resourceId))
  if (missing.length > 0) {
    throw new MultiLayerDocumentNodeApplicationError(
      'OPERATION_FAILED',
      `导出目标缺失 ${missing.length} 个像素资源，请先修复文档资源`,
      true,
    )
  }
}

function normalizeTargetError(error: unknown): never {
  if (error instanceof ImageEditExportTargetErrorV3) {
    throw new MultiLayerDocumentNodeApplicationError(
      error.code === 'UNSUPPORTED_EXPORT_TARGET'
        ? 'UNSUPPORTED_EXPORT_TARGET'
        : 'INVALID_INPUT',
      error.message,
      false,
      { cause: error },
    )
  }
  throw error
}

/**
 * 3.1 的唯一导出窄适配器。1.2 组装完整 documentPort 时必须复用这两个方法，
 * 禁止再从会话选中状态或 React DOM 构造另一条导出路径。
 */
export function createMultiLayerDocumentExportPort(
  dependencies: AdapterDependencies = {},
): MultiLayerDocumentExportPort {
  const loadDocument = dependencies.loadDocument ?? loadImageEditorV3Document
  const materialize = dependencies.materialize ?? materializeImageEditorV3StandaloneRaster
  const releaseManagedImages = dependencies.releaseManagedImages
    ?? ((filePaths) => getPlatform().image.releaseManagedGenerationMedia(filePaths))

  return {
    async materializeExportTarget({ session, target, signal }): Promise<MultiLayerDocumentExportRaster> {
      throwIfAborted(signal)
      const snapshot = await loadDocument({
        requestId: createImageEditorV3RequestId('layer-export-load'),
        documentRef: session.documentRef,
      }, signal)
      if (!snapshot) {
        throw new MultiLayerDocumentNodeApplicationError(
          'DOCUMENT_NOT_FOUND',
          '多图层图片文档不存在',
          true,
        )
      }
      throwIfAborted(signal)
      if (
        snapshot.documentRef !== session.documentRef
        || snapshot.document.id !== documentIdFromRef(session.documentRef)
        || snapshot.revision !== session.revision
        || snapshot.document.revision !== session.revision
        || snapshot.previewRef !== session.previewRef
      ) {
        throw new MultiLayerDocumentNodeApplicationError(
          'DOCUMENT_CONFLICT',
          '独立导出前文档版本已变化',
          true,
        )
      }

      let view: ImageEditExportTargetViewV3
      try {
        view = createImageEditExportTargetViewV3(snapshot.document, toCoreTarget(target))
      } catch (error) {
        normalizeTargetError(error)
      }
      assertResourcesAvailable(
        view.document,
        new Set(snapshot.resources.map((resource) => resource.resourceRef)),
      )
      const format = pngFormat(view.document.color.bitDepth)
      const spec = createImageMarkV3RasterExportSpec(view.document, view.displayName, {
        format,
        suggestedName: `${view.displayName}.png`,
      })
      prepareImageEditorV3ExportRender(view.document, spec.description)
      const tiles = renderImageEditorV3ExportTiles({
        document: view.document,
        resourceDescriptors: snapshot.resources,
        description: spec.description,
        tileSize: EXPORT_TILE_SIZE,
        signal,
      })
      const result = await materialize({
        documentRef: snapshot.documentRef,
        revision: snapshot.revision,
        sourceFingerprint: snapshot.sourceFingerprint,
        format: spec.format,
        description: spec.description,
        tiles,
        tileSize: EXPORT_TILE_SIZE,
      }, signal)
      if (
        result.documentRef !== snapshot.documentRef
        || result.revision !== snapshot.revision
        || result.sourceFingerprint !== snapshot.sourceFingerprint
        || result.format !== format
        || result.width !== spec.description.width
        || result.height !== spec.description.height
      ) {
        await releaseManagedImages(result.createdFilePaths).catch(() => undefined)
        throw new MultiLayerDocumentNodeApplicationError(
          'DOCUMENT_CONFLICT',
          '独立导出结果与权威文档快照不一致',
          true,
        )
      }
      return {
        imageUrl: result.imagePath,
        previewImageUrl: result.imagePath,
        aspectRatio: aspectRatio(result.width, result.height),
        width: result.width,
        height: result.height,
        mediaType: 'image/png',
        hasAlpha: true,
        displayName: view.displayName,
        ownedFilePaths: [...result.createdFilePaths],
        diagnostics: {
          documentId: snapshot.document.id,
          revision: snapshot.revision,
          targetKind: target.kind,
          targetId: view.targetId,
          layerPath: [...view.layerPath],
          canvasScope: 'document',
          contentState: view.contentState,
        },
      }
    },

    async releaseExportRaster({ raster }): Promise<void> {
      if (raster.ownedFilePaths.length === 0) return
      await releaseManagedImages([...raster.ownedFilePaths])
    },
  }
}
