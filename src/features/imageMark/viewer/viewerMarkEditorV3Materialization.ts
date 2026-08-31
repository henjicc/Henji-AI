import { materializeImageEditorV3Raster } from '@/commands/imageEditorV3Export'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorCapabilityReadinessV3 } from '@/features/imageEdit/v3/application/imageEditorHostProfiles'
import {
  prepareImageEditorV3ExportRender,
  renderImageEditorV3ExportTiles,
} from '@/features/imageEdit/v3/export'
import type {
  ImageEditorV3DocumentSnapshot,
  ImageEditorV3ManagedRasterExportResult,
} from '@/platform/contracts/imageEditorV3'
import {
  createImageMarkV3RasterExportSpec,
  resolveImageMarkV3RasterExportReadiness,
} from '../standalone/imageMarkV3RasterExport'

const MATERIALIZATION_TILE_SIZE = 512

export interface ViewerMarkV3MaterializationProgress {
  completed: number
  total: number
}

export interface MaterializeViewerMarkV3RasterOptions {
  snapshot: ImageEditorV3DocumentSnapshot
  sourceName: string
  signal: AbortSignal
  onProgress?: (progress: ViewerMarkV3MaterializationProgress) => void
}

function abortError(): Error {
  const error = new Error('替换查看器图片已取消')
  error.name = 'AbortError'
  return error
}

export function isViewerMarkV3MaterializationAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function resolveViewerMarkV3MaterializationReadiness(
  document: ImageEditDocumentV3,
  sourceName: string,
): ImageEditorCapabilityReadinessV3 {
  const readiness = resolveImageMarkV3RasterExportReadiness(document, sourceName)
  if (readiness.state === 'ready') return readiness
  return {
    state: 'disabled',
    reasonKey: readiness.reasonKey,
    reason: readiness.reason,
  }
}

/**
 * 消费已持久化的权威快照，逐瓦片渲染到主进程受管目标；渲染层不会创建全帧表面。
 */
export async function materializeViewerMarkV3Raster({
  snapshot,
  sourceName,
  signal,
  onProgress,
}: MaterializeViewerMarkV3RasterOptions): Promise<ImageEditorV3ManagedRasterExportResult> {
  if (signal.aborted) throw abortError()
  const spec = createImageMarkV3RasterExportSpec(snapshot.document, sourceName)
  prepareImageEditorV3ExportRender(snapshot.document, spec.description)
  const tiles = renderImageEditorV3ExportTiles({
    document: snapshot.document,
    resourceDescriptors: snapshot.resources,
    description: spec.description,
    tileSize: MATERIALIZATION_TILE_SIZE,
    signal,
    onTileRendered: (completed, total) => onProgress?.({ completed, total }),
  })
  const result = await materializeImageEditorV3Raster({
    documentRef: snapshot.documentRef,
    revision: snapshot.revision,
    sourceFingerprint: snapshot.sourceFingerprint,
    format: spec.format,
    description: spec.description,
    tiles,
    tileSize: MATERIALIZATION_TILE_SIZE,
  }, signal)
  if (
    result.documentRef !== snapshot.documentRef
    || result.revision !== snapshot.revision
    || result.sourceFingerprint !== snapshot.sourceFingerprint
  ) {
    throw new Error('受管图片结果与已保存的快速编辑版本不一致')
  }
  return result
}
