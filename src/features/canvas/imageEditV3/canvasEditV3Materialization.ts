import { materializeImageEditorV3Raster } from '@/commands/imageEditorV3Export'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit'
import {
  prepareImageEditorV3ExportRender,
  renderImageEditorV3ExportTiles,
} from '@/features/imageEdit/v3/export'
import {
  createImageMarkV3RasterExportSpec,
} from '@/features/imageMark/standalone/imageMarkV3RasterExport'
import type {
  ImageEditorV3DocumentSnapshot,
  ImageEditorV3ManagedRasterExportResult,
} from '@/platform/contracts/imageEditorV3'

const CANVAS_EDIT_MATERIALIZATION_TILE_SIZE = 512

export interface CanvasEditV3MaterializationResult {
  raster: ImageEditorV3ManagedRasterExportResult
  session: ImageEditSessionReferenceV3
}

export async function materializeCanvasEditV3Snapshot(
  snapshot: ImageEditorV3DocumentSnapshot,
  sourceName: string,
  signal?: AbortSignal,
): Promise<CanvasEditV3MaterializationResult> {
  if (signal?.aborted) {
    const error = new Error('画布图片编辑输出已取消')
    error.name = 'AbortError'
    throw error
  }
  const spec = createImageMarkV3RasterExportSpec(snapshot.document, sourceName)
  prepareImageEditorV3ExportRender(snapshot.document, spec.description)
  const tiles = renderImageEditorV3ExportTiles({
    document: snapshot.document,
    resourceDescriptors: snapshot.resources,
    description: spec.description,
    tileSize: CANVAS_EDIT_MATERIALIZATION_TILE_SIZE,
    signal,
  })
  const raster = await materializeImageEditorV3Raster({
    documentRef: snapshot.documentRef,
    revision: snapshot.revision,
    sourceFingerprint: snapshot.sourceFingerprint,
    format: spec.format,
    description: spec.description,
    tiles,
    tileSize: CANVAS_EDIT_MATERIALIZATION_TILE_SIZE,
  }, signal)
  if (
    raster.documentRef !== snapshot.documentRef
    || raster.revision !== snapshot.revision
    || raster.sourceFingerprint !== snapshot.sourceFingerprint
  ) {
    throw new Error('画布图片编辑输出与权威文档版本不一致')
  }
  return {
    raster,
    session: {
      kind: 'image-edit-v3',
      sourceUrl: raster.mediaUrl,
      documentRef: raster.documentRef,
      revision: raster.revision,
      previewRef: raster.previewRef,
    },
  }
}
