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
import {
  IMAGE_EDITOR_V3_HDR_AVIF_MAX_PIXELS,
  type ImageEditorV3DialogResult,
  type ImageEditorV3DocumentSnapshot,
  type ImageEditorV3RasterExportDescription,
  type ImageEditorV3RasterExportFormat,
  type ImageEditorV3RasterExportResult,
} from '@/platform/contracts/imageEditorV3'

const EXPORT_TILE_SIZE = 512

export interface ImageMarkV3RasterExportProgress {
  completed: number
  total: number
}

export interface ExportImageMarkV3RasterOptions {
  snapshot: ImageEditorV3DocumentSnapshot
  sourceName: string
  format: ImageEditorV3RasterExportFormat
  suggestedName: string
  signal: AbortSignal
  onProgress?: (progress: ImageMarkV3RasterExportProgress) => void
}

export interface ImageMarkV3RasterExportSpec {
  format: ImageEditorV3RasterExportFormat
  description: ImageEditorV3RasterExportDescription
  suggestedName: string
}

class ImageMarkV3RasterExportContractError extends Error {
  constructor(readonly reasonKey: ImageEditorReadinessReasonKeyV3) {
    super(reasonKey)
    this.name = 'ImageMarkV3RasterExportContractError'
  }
}

const EIGHT_BIT_SDR_FORMATS = [
  'png8', 'jpeg', 'webp', 'tiff8', 'bigtiff',
] as const satisfies readonly ImageEditorV3RasterExportFormat[]
const SIXTEEN_BIT_SDR_FORMATS = [
  'png16', 'tiff16', 'avif10', 'avif12', 'bigtiff',
] as const satisfies readonly ImageEditorV3RasterExportFormat[]
const HDR_AVIF_FORMATS = [
  'avif10', 'avif12',
] as const satisfies readonly ImageEditorV3RasterExportFormat[]

export function imageMarkV3RasterExportExtension(
  format: ImageEditorV3RasterExportFormat,
): 'avif' | 'jpg' | 'png' | 'tif' | 'webp' {
  if (format === 'jpeg') return 'jpg'
  if (format === 'webp') return 'webp'
  if (format === 'avif10' || format === 'avif12') return 'avif'
  if (format === 'png8' || format === 'png16') return 'png'
  return 'tif'
}

function documentHasHdrMetadata(document: ImageEditDocumentV3): boolean {
  return document.color.transferFunction === 'pq'
    || document.color.transferFunction === 'hlg'
    || document.color.hdrMetadata !== null
}

function isHdrAvifFormat(format: ImageEditorV3RasterExportFormat): boolean {
  return format === 'avif10' || format === 'avif12'
}

function hasValidHdrDocumentContract(document: ImageEditDocumentV3): boolean {
  const transfer = document.color.transferFunction
  const metadata = document.color.hdrMetadata
  const expectedTransfer = transfer === 'pq' ? 16 : transfer === 'hlg' ? 18 : null
  const hasHdrPrecision = document.color.bitDepth === 16
    || document.color.bitDepth === 'float16'
    || document.color.bitDepth === 'float32'
  return expectedTransfer !== null
    && metadata !== null
    && metadata.standard === transfer
    && Number.isFinite(metadata.referenceWhiteNits)
    && metadata.referenceWhiteNits > 0
    && metadata.referenceWhiteNits <= 10_000
    && document.color.workingSpace === 'rec2020'
    && hasHdrPrecision
    && document.color.iccProfileResourceId === null
    && metadata.cicp.colorPrimaries === 9
    && metadata.cicp.transferCharacteristics === expectedTransfer
    && metadata.cicp.matrixCoefficients === 9
    && metadata.cicp.fullRange === false
}

function hasValidHdrAvifDocumentContract(document: ImageEditDocumentV3): boolean {
  return hasValidHdrDocumentContract(document)
    && document.color.hdrMetadata?.masteringDisplay === undefined
    && document.color.hdrMetadata?.contentLight === undefined
}

function assertHdrDocumentContract(document: ImageEditDocumentV3): void {
  if (hasValidHdrDocumentContract(document)) return
  throw new ImageMarkV3RasterExportContractError(
    'imageEditor.v3.readiness.reasons.exportHdrMetadata',
  )
}

function assertHdrAvifDocumentContract(document: ImageEditDocumentV3): void {
  assertHdrDocumentContract(document)
  if (hasValidHdrAvifDocumentContract(document)) return
  throw new ImageMarkV3RasterExportContractError(
    'imageEditor.v3.readiness.reasons.exportHdrMetadata',
  )
}

function hdrAvifOutputWithinLimit(document: ImageEditDocumentV3): boolean {
  const geometry = resolveImageEditorV3ExportGeometry(document)
  return geometry.outputWidth <= Math.floor(
    IMAGE_EDITOR_V3_HDR_AVIF_MAX_PIXELS / geometry.outputHeight,
  )
}

function assertHdrAvifOutputWithinLimit(
  geometry: { outputWidth: number; outputHeight: number },
): void {
  if (geometry.outputWidth <= Math.floor(
    IMAGE_EDITOR_V3_HDR_AVIF_MAX_PIXELS / geometry.outputHeight,
  )) return
  throw new ImageMarkV3RasterExportContractError(
    'imageEditor.v3.readiness.reasons.exportHdrPixelLimit',
  )
}

/**
 * 只暴露当前链路能无损表达的格式。线性整数文档与浮点文档均保留到 BigTIFF，
 * PQ/HLG 同时支持带严格 CICP 的 AVIF 和 scene-linear Rec.2020 Float32 BigTIFF；
 * AVIF 在编码边界显式量化为 16-bit renderer tiles，BigTIFF 不裁剪负值与超白。
 */
export function listImageMarkV3RasterExportFormats(
  document: ImageEditDocumentV3,
): readonly ImageEditorV3RasterExportFormat[] {
  if (documentHasHdrMetadata(document)) {
    if (!hasValidHdrDocumentContract(document)) return []
    return hasValidHdrAvifDocumentContract(document) && hdrAvifOutputWithinLimit(document)
      ? [...HDR_AVIF_FORMATS, 'bigtiff']
      : ['bigtiff']
  }
  if (document.color.bitDepth === 'float16' || document.color.bitDepth === 'float32') {
    return ['bigtiff']
  }
  if (document.color.transferFunction !== 'srgb') return ['bigtiff']
  if (document.color.bitDepth === 8) return EIGHT_BIT_SDR_FORMATS
  if (document.color.bitDepth === 16) return SIXTEEN_BIT_SDR_FORMATS
  return []
}

export function isImageMarkV3RasterExportAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export interface ImageMarkV3RasterExportFailureReason {
  reasonKey?: ImageEditorReadinessReasonKeyV3
  reason?: string
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

function exportPrecision(
  document: ImageEditDocumentV3,
  format: ImageEditorV3RasterExportFormat,
): {
  bitDepth: 8 | 16 | 32
  sampleFormat: 'uint' | 'float'
} {
  if (documentHasHdrMetadata(document)) {
    assertHdrDocumentContract(document)
    return format === 'bigtiff'
      ? { bitDepth: 32, sampleFormat: 'float' }
      : { bitDepth: 16, sampleFormat: 'uint' }
  }
  if (document.color.bitDepth === 8) return { bitDepth: 8, sampleFormat: 'uint' }
  if (document.color.bitDepth === 16) return { bitDepth: 16, sampleFormat: 'uint' }
  if (document.color.bitDepth === 'float16' || document.color.bitDepth === 'float32') {
    return { bitDepth: 32, sampleFormat: 'float' }
  }
  throw new ImageMarkV3RasterExportContractError(
    'imageEditor.v3.readiness.reasons.exportBitDepth',
  )
}

function defaultPngFormat(document: ImageEditDocumentV3): ImageEditorV3RasterExportFormat {
  if (documentHasHdrMetadata(document)) {
    return hasValidHdrAvifDocumentContract(document) && hdrAvifOutputWithinLimit(document)
      ? 'avif10'
      : 'bigtiff'
  }
  return document.color.bitDepth === 16 ? 'png16' : 'png8'
}

export function createImageMarkV3RasterExportSpec(
  document: ImageEditDocumentV3,
  sourceName: string,
  options: {
    format?: ImageEditorV3RasterExportFormat
    suggestedName?: string
  } = {},
): ImageMarkV3RasterExportSpec {
  const format = options.format ?? defaultPngFormat(document)
  const geometry = resolveImageEditorV3ExportGeometry(document)
  if (documentHasHdrMetadata(document)) {
    assertHdrDocumentContract(document)
    if (isHdrAvifFormat(format)) {
      assertHdrAvifDocumentContract(document)
      assertHdrAvifOutputWithinLimit(geometry)
    } else if (format !== 'bigtiff') {
      throw new ImageMarkV3RasterExportContractError(
        'imageEditor.v3.readiness.reasons.exportHdrMetadata',
      )
    }
  }
  const allowedFormats = listImageMarkV3RasterExportFormats(document)
  if (!allowedFormats.includes(format)) {
    exportPrecision(document, format)
    throw new ImageMarkV3RasterExportContractError(
      'imageEditor.v3.readiness.reasons.exportBitDepth',
    )
  }
  const precision = exportPrecision(document, format)
  const hdrMetadata = documentHasHdrMetadata(document) ? document.color.hdrMetadata : null
  const hdrBigTiff = hdrMetadata !== null && format === 'bigtiff'
  const iccProfileResourceRef = hdrMetadata
    ? null
    : optionalResourceRef(document.color.iccProfileResourceId)
  if (!hdrMetadata && document.color.workingSpace !== 'srgb' && !iccProfileResourceRef) {
    throw new ImageMarkV3RasterExportContractError(
      'imageEditor.v3.readiness.reasons.exportInvalidIcc',
    )
  }
  const description: ImageEditorV3RasterExportDescription = {
    width: geometry.outputWidth,
    height: geometry.outputHeight,
    ...precision,
    colorSpace: document.color.workingSpace,
    transferFunction: hdrBigTiff ? 'linear' : document.color.transferFunction,
    alphaMode: 'straight',
    iccProfileResourceRef,
    cicp: hdrMetadata && !hdrBigTiff ? { ...hdrMetadata.cicp } : null,
    hdrMetadata: null,
  }
  return {
    format,
    description,
    suggestedName: options.suggestedName
      ?? `${imageStem(sourceName)}-edited.${imageMarkV3RasterExportExtension(format)}`,
  }
}

export function resolveImageMarkV3RasterExportReadiness(
  document: ImageEditDocumentV3,
  sourceName: string,
  format?: ImageEditorV3RasterExportFormat,
): ImageEditorCapabilityReadinessV3 {
  try {
    const spec = createImageMarkV3RasterExportSpec(document, sourceName, { format })
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
  format,
  suggestedName,
  signal,
  onProgress,
}: ExportImageMarkV3RasterOptions): Promise<ImageEditorV3DialogResult<ImageEditorV3RasterExportResult>> {
  if (signal.aborted) {
    const error = new Error('图片栅格导出已取消')
    error.name = 'AbortError'
    throw error
  }
  const spec = createImageMarkV3RasterExportSpec(snapshot.document, sourceName, {
    format,
    suggestedName,
  })
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
