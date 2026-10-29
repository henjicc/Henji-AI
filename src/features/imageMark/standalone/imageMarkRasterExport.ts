import { exportImageEditorV3Raster } from '@/commands/imageEditorV3Export'
import { prepareImageEditorV3ExportRender, renderImageEditorV3ExportTilesWithGpu } from '@/features/imageEdit/v3/export'
import type { ImageEditorV3DialogResult, ImageEditorV3DocumentSnapshot, ImageEditorV3RasterExportFormat,
  ImageEditorV3RasterExportResult } from '@/platform/contracts/imageEditorV3'
import { createImageMarkRasterExportSpec } from './imageMarkRasterExportSpec'

export * from './imageMarkRasterExportSpec'

const EXPORT_TILE_SIZE = 512

export interface ImageMarkRasterExportProgress {
  completed: number
  total: number
}

export interface ExportImageMarkRasterOptions {
  snapshot: ImageEditorV3DocumentSnapshot
  sourceName: string
  format: ImageEditorV3RasterExportFormat
  suggestedName: string
  signal: AbortSignal
  onProgress?: (progress: ImageMarkRasterExportProgress) => void
}

/**
 * 消费不可变权威快照并逐瓦片渲染、写入；任何阶段都不会创建完整输出表面。
 */
export async function exportImageMarkRaster({
  snapshot,
  sourceName,
  format,
  suggestedName,
  signal,
  onProgress,
}: ExportImageMarkRasterOptions): Promise<ImageEditorV3DialogResult<ImageEditorV3RasterExportResult>> {
  if (signal.aborted) {
    const error = new Error('图片栅格导出已取消')
    error.name = 'AbortError'
    throw error
  }
  const spec = createImageMarkRasterExportSpec(snapshot.document, sourceName, {
    format,
    suggestedName,
  })
  // AsyncGenerator 在首次 next() 前不会执行函数体，因此这里显式预检，避免先创建输出会话
  // 或弹出保存位置，再发现效果、颜色或几何不可导出。
  prepareImageEditorV3ExportRender(snapshot.document, spec.description)
  const tiles = renderImageEditorV3ExportTilesWithGpu({
    document: snapshot.document,
    resourceDescriptors: snapshot.resources,
    description: spec.description,
    tileSize: EXPORT_TILE_SIZE,
    signal,
    onTileRendered: (completed, total) => onProgress?.({ completed, total }),
  })
  return exportImageEditorV3Raster({
    documentRef: snapshot.documentRef,
    revision: snapshot.revision,
    sourceFingerprint: snapshot.sourceFingerprint,
    format: spec.format,
    description: spec.description,
    tiles,
    suggestedName: spec.suggestedName,
    tileSize: EXPORT_TILE_SIZE,
  }, signal)
}
