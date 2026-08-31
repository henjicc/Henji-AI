import { exportImageEditorV3Raster } from '@/commands/imageEditorV3Export'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import {
  prepareImageEditorV3ExportRender,
  renderImageEditorV3ExportTiles,
  resolveImageEditorV3ExportGeometry,
} from '@/features/imageEdit/v3/export'
import type {
  ImageEditorCapabilityReadinessV3,
  ImageEditorReadinessReasonKeyV3,
} from '@/features/imageEdit/v3/application/imageEditorHostProfiles'
import type {
  ImageEditorV3DialogResult,
  ImageEditorV3DocumentSnapshot,
  ImageEditorV3RasterExportDescription,
  ImageEditorV3RasterExportFormat,
  ImageEditorV3RasterExportResult,
} from '@/platform/contracts/imageEditorV3'

const EXPORT_TILE_SIZE = 512

export interface ImageMarkV3RasterExportProgress {
  completed: number
  total: number
}

export interface ExportImageMarkV3RasterOptions {
  snapshot: ImageEditorV3DocumentSnapshot
  sourceName: string
  suggestedName: string
  signal: AbortSignal
  onProgress?: (progress: ImageMarkV3RasterExportProgress) => void
}

export interface ImageMarkV3RasterExportSpec {
  format: ImageEditorV3RasterExportFormat
  description: ImageEditorV3RasterExportDescription
  suggestedName: string
}

export function isImageMarkV3RasterExportAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export interface ImageMarkV3RasterExportFailureReason {
  reasonKey?: ImageEditorReadinessReasonKeyV3
  reason?: string
}

class ImageMarkV3RasterExportContractError extends Error {
  constructor(readonly reasonKey: ImageEditorReadinessReasonKeyV3) {
    super(reasonKey)
    this.name = 'ImageMarkV3RasterExportContractError'
  }
}

export function resolveImageMarkV3RasterExportFailureReason(
  error: unknown,
): ImageMarkV3RasterExportFailureReason {
  if (error instanceof ImageMarkV3RasterExportContractError) {
    return { reasonKey: error.reasonKey }
  }
  if (error instanceof Error && error.message.trim()) return { reason: error.message.trim() }
  return {}
}

function imageStem(sourceName: string): string {
  return sourceName.replace(/\.[^.]+$/, '').trim() || 'image'
}

function optionalResourceRef(value: string | null): `sha256:${string}` | null {
  if (value === null) return null
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ImageMarkV3RasterExportContractError(
      'imageEditor.v3.readiness.reasons.exportInvalidIcc',
    )
  }
  return value as `sha256:${string}`
}

function assertSdrIntegerDocument(document: ImageEditDocumentV3): 8 | 16 {
  if (
    document.color.transferFunction === 'pq'
    || document.color.transferFunction === 'hlg'
    || document.color.hdrMetadata !== null
  ) {
    throw new ImageMarkV3RasterExportContractError(
      'imageEditor.v3.readiness.reasons.exportHdrMetadata',
    )
  }
  if (document.color.bitDepth !== 8 && document.color.bitDepth !== 16) {
    throw new ImageMarkV3RasterExportContractError(
      'imageEditor.v3.readiness.reasons.exportBitDepth',
    )
  }
  return document.color.bitDepth
}

export function createImageMarkV3RasterExportSpec(
  document: ImageEditDocumentV3,
  sourceName: string,
  suggestedName = `${imageStem(sourceName)}-edited.png`,
): ImageMarkV3RasterExportSpec {
  const bitDepth = assertSdrIntegerDocument(document)
  const geometry = resolveImageEditorV3ExportGeometry(document)
  const format = bitDepth === 8 ? 'png8' : 'png16'
  const description: ImageEditorV3RasterExportDescription = {
    width: geometry.outputWidth,
    height: geometry.outputHeight,
    bitDepth,
    sampleFormat: 'uint',
    colorSpace: document.color.workingSpace,
    transferFunction: document.color.transferFunction,
    alphaMode: 'straight',
    iccProfileResourceRef: optionalResourceRef(document.color.iccProfileResourceId),
    cicp: null,
    hdrMetadata: null,
  }
  return {
    format,
    description,
    suggestedName,
  }
}

export function resolveImageMarkV3RasterExportReadiness(
  document: ImageEditDocumentV3,
  sourceName: string,
): ImageEditorCapabilityReadinessV3 {
  try {
    const spec = createImageMarkV3RasterExportSpec(document, sourceName)
    prepareImageEditorV3ExportRender(document, spec.description)
    return { state: 'ready' }
  } catch (error) {
    return {
      state: 'disabled',
      ...resolveImageMarkV3RasterExportFailureReason(error),
    }
  }
}

/**
 * 消费不可变权威快照并逐瓦片渲染、写入；任何阶段都不会创建完整输出表面。
 */
export async function exportImageMarkV3Raster({
  snapshot,
  sourceName,
  suggestedName,
  signal,
  onProgress,
}: ExportImageMarkV3RasterOptions): Promise<ImageEditorV3DialogResult<ImageEditorV3RasterExportResult>> {
  if (signal.aborted) {
    const error = new Error('图片栅格导出已取消')
    error.name = 'AbortError'
    throw error
  }
  const spec = createImageMarkV3RasterExportSpec(snapshot.document, sourceName, suggestedName)
  // AsyncGenerator 在首次 next() 前不会执行函数体，因此这里显式预检，避免先创建输出会话
  // 或弹出保存位置，再发现效果、颜色或几何不可导出。
  prepareImageEditorV3ExportRender(snapshot.document, spec.description)
  const tiles = renderImageEditorV3ExportTiles({
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
