import { materializeImageEditorV3Raster } from '@/commands/imageEditorV3Export'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit'
type ExportRenderer = typeof import('../export')
async function loadExportRenderer(): Promise<ExportRenderer> { return import('../export') }
import {
  createImageMarkV3RasterExportSpec,
} from './imageEditRasterExportSpecV3'
import type {
  ImageEditorV3DocumentSnapshot,
  ImageEditorV3ManagedRasterExportResult,
} from '@/platform/contracts/imageEditorV3'

const IMAGE_EDIT_MATERIALIZATION_TILE_SIZE = 512

export interface ImageEditMaterializationResultV3 {
  raster: ImageEditorV3ManagedRasterExportResult
  session: ImageEditSessionReferenceV3
}

export class ImageEditMaterializationContractErrorV3 extends Error {
  constructor(
    message: string,
    readonly result: ImageEditMaterializationResultV3,
  ) {
    super(message)
    this.name = 'ImageEditMaterializationContractErrorV3'
  }
}

export async function materializeImageEditSnapshotV3(
  snapshot: ImageEditorV3DocumentSnapshot,
  sourceName: string,
  signal?: AbortSignal,
  loadRenderer: () => Promise<ExportRenderer> = loadExportRenderer,
): Promise<ImageEditMaterializationResultV3> {
  if (signal?.aborted) {
    const error = new Error('图片编辑输出已取消')
    error.name = 'AbortError'
    throw error
  }
  const spec = createImageMarkV3RasterExportSpec(snapshot.document, sourceName)
  const { prepareImageEditorV3ExportRender, renderImageEditorV3ExportTilesWithGpu } = await loadRenderer()
  if (signal?.aborted) {
    const error = new Error('图片编辑输出已取消')
    error.name = 'AbortError'
    throw error
  }
  prepareImageEditorV3ExportRender(snapshot.document, spec.description)
  const tiles = renderImageEditorV3ExportTilesWithGpu({
    document: snapshot.document,
    resourceDescriptors: snapshot.resources,
    description: spec.description,
    tileSize: IMAGE_EDIT_MATERIALIZATION_TILE_SIZE,
    signal,
  })
  const raster = await materializeImageEditorV3Raster({
    documentRef: snapshot.documentRef,
    revision: snapshot.revision,
    sourceFingerprint: snapshot.sourceFingerprint,
    format: spec.format,
    description: spec.description,
    tiles,
    tileSize: IMAGE_EDIT_MATERIALIZATION_TILE_SIZE,
  }, signal)
  const result: ImageEditMaterializationResultV3 = {
    raster,
    session: {
      kind: 'image-edit-v3',
      sourceUrl: raster.mediaUrl,
      documentRef: raster.documentRef,
      revision: raster.revision,
      previewRef: raster.previewRef,
    },
  }
  if (
    raster.documentRef !== snapshot.documentRef
    || raster.revision !== snapshot.revision
    || raster.sourceFingerprint !== snapshot.sourceFingerprint
  ) {
    throw new ImageEditMaterializationContractErrorV3(
      '图片编辑输出与权威文档版本不一致',
      result,
    )
  }
  if (
    raster.format !== spec.format
    || raster.width !== spec.description.width
    || raster.height !== spec.description.height
    || !raster.mediaUrl.trim()
  ) {
    throw new ImageEditMaterializationContractErrorV3(
      '图片编辑输出尺寸或格式与权威渲染计划不一致',
      result,
    )
  }
  return result
}
