import crypto from 'node:crypto'

import type { ImageEditDocumentEnvelope } from './contracts'
import {
  ImageExportCapabilityError,
  type RasterExportFormat,
} from './export'
import type { RasterExportPixelDescription } from './raster-export-session'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Invalid image edit document ${field}`)
  }
  return value as number
}

export function readRasterExportOutputDimensions(
  document: unknown,
): { width: number; height: number } {
  if (!isRecord(document) || !isRecord(document.geometry)) {
    throw new Error('Invalid image edit document geometry')
  }
  const geometry = document.geometry
  const canvasWidth = readPositiveInteger(geometry, 'width')
  const canvasHeight = readPositiveInteger(geometry, 'height')
  if (!isRecord(geometry.orientation)
    || ![0, 90, 180, 270].includes(geometry.orientation.rotate as number)
    || typeof geometry.orientation.mirrored !== 'boolean') {
    throw new Error('Invalid image edit document orientation')
  }
  const rotated = geometry.orientation.rotate === 90 || geometry.orientation.rotate === 270
  const orientedWidth = rotated ? canvasHeight : canvasWidth
  const orientedHeight = rotated ? canvasWidth : canvasHeight
  if (geometry.crop === null) return { width: orientedWidth, height: orientedHeight }
  if (!isRecord(geometry.crop)) throw new Error('Invalid image edit document crop')
  const { x, y, width, height } = geometry.crop
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0
    || typeof y !== 'number' || !Number.isFinite(y) || y < 0
    || !Number.isSafeInteger(width) || (width as number) < 1
    || !Number.isSafeInteger(height) || (height as number) < 1
    || x + (width as number) > orientedWidth || y + (height as number) > orientedHeight) {
    throw new Error('Image edit document crop exceeds its oriented canvas')
  }
  return { width: width as number, height: height as number }
}

export function assertDocumentColorMatchesRasterExport(
  document: unknown,
  format: RasterExportFormat,
  description: RasterExportPixelDescription,
): void {
  if (!isRecord(document) || !isRecord(document.color)) {
    throw new Error('Invalid image edit document color mode')
  }
  const { workingSpace, bitDepth, transferFunction, hdrMetadata, iccProfileResourceId } = document.color
  if (workingSpace !== 'srgb' && workingSpace !== 'display-p3' && workingSpace !== 'rec2020') {
    throw new Error('Invalid image edit document working space')
  }
  const expectedPrecision = bitDepth === 8
    ? { bitDepth: 8 as const, sampleFormat: 'uint' as const }
    : bitDepth === 16
      ? { bitDepth: 16 as const, sampleFormat: 'uint' as const }
      : bitDepth === 'float16' || bitDepth === 'float32'
        ? { bitDepth: 32 as const, sampleFormat: 'float' as const }
      : null
  if (!expectedPrecision) throw new Error('Invalid image edit document bit depth')

  const isHdr = transferFunction === 'pq' || transferFunction === 'hlg'
  if (isHdr) {
    const hasHdrSourcePrecision = bitDepth === 16
      || bitDepth === 'float16'
      || bitDepth === 'float32'
    if ((format !== 'avif10' && format !== 'avif12')
      || workingSpace !== 'rec2020'
      || !hasHdrSourcePrecision
      || !isRecord(hdrMetadata)
      || hdrMetadata.standard !== transferFunction
      || typeof hdrMetadata.referenceWhiteNits !== 'number'
      || !Number.isFinite(hdrMetadata.referenceWhiteNits)
      || hdrMetadata.referenceWhiteNits <= 0
      || !isRecord(hdrMetadata.cicp)) {
      throw new ImageExportCapabilityError(
        'HDR_METADATA_UNSUPPORTED',
        format,
        'HDR AVIF requires a 16-bit or floating-point Rec.2020 document with matching PQ/HLG metadata',
      )
    }
    const cicp = hdrMetadata.cicp
    const expectedTransfer = transferFunction === 'pq' ? 16 : 18
    if (cicp.colorPrimaries !== 9
      || cicp.transferCharacteristics !== expectedTransfer
      || cicp.matrixCoefficients !== 9
      || cicp.fullRange !== false
      || description.cicp?.colorPrimaries !== cicp.colorPrimaries
      || description.cicp?.transferCharacteristics !== cicp.transferCharacteristics
      || description.cicp?.matrixCoefficients !== cicp.matrixCoefficients
      || description.cicp?.fullRange !== cicp.fullRange) {
      throw new ImageExportCapabilityError(
        'INVALID_COLOR_METADATA',
        format,
        'Raster export CICP metadata does not match the HDR document snapshot',
      )
    }
    if (hdrMetadata.masteringDisplay !== undefined
      || hdrMetadata.contentLight !== undefined
      || (description.hdrMetadata
        && Object.values(description.hdrMetadata).some((value) => value !== undefined))) {
      throw new ImageExportCapabilityError(
        'HDR_METADATA_UNSUPPORTED',
        format,
        'HDR mastering-display and content-light metadata cannot yet be encoded reliably',
      )
    }
    if (description.bitDepth !== 16
      || description.sampleFormat !== 'uint'
      || description.colorSpace !== 'rec2020'
      || description.transferFunction !== transferFunction
      || description.alphaMode !== 'straight'
      || iccProfileResourceId !== null
      || description.iccProfileResourceId !== undefined) {
      throw new ImageExportCapabilityError(
        'INVALID_COLOR_METADATA',
        format,
        'Raster export pixels do not match the HDR document color contract',
      )
    }
    return
  }
  if (hdrMetadata !== null) {
    throw new ImageExportCapabilityError(
      'INVALID_COLOR_METADATA',
      format,
      'SDR document cannot carry HDR metadata',
    )
  }
  if (description.bitDepth !== expectedPrecision.bitDepth
    || description.sampleFormat !== expectedPrecision.sampleFormat) {
    throw new ImageExportCapabilityError(
      'SOURCE_PRECISION_UNSUPPORTED',
      format,
      `Raster export tiles must preserve the document precision (${String(bitDepth)})`,
    )
  }
  if (description.colorSpace !== workingSpace) {
    throw new ImageExportCapabilityError(
      'INVALID_COLOR_METADATA',
      format,
      `Raster export tiles must preserve the document working space (${workingSpace})`,
    )
  }
  if (description.transferFunction !== transferFunction) {
    throw new ImageExportCapabilityError(
      'TRANSFER_FUNCTION_UNSUPPORTED',
      format,
      `Raster export tiles must preserve the document transfer function (${String(transferFunction)})`,
    )
  }
  const expectedIcc = typeof iccProfileResourceId === 'string' ? iccProfileResourceId : undefined
  if (description.iccProfileResourceId !== expectedIcc) {
    throw new ImageExportCapabilityError(
      'INVALID_COLOR_METADATA',
      format,
      'Raster export ICC metadata does not match the document snapshot',
    )
  }
  const requiresEightBit = format === 'jpeg' || format === 'webp' || format === 'png8' || format === 'tiff8'
  const requiresSixteenBit = format === 'png16' || format === 'tiff16'
    || format === 'avif10' || format === 'avif12'
  if ((requiresEightBit && expectedPrecision.bitDepth !== 8)
    || (requiresSixteenBit && expectedPrecision.bitDepth !== 16)) {
    throw new ImageExportCapabilityError(
      'SOURCE_PRECISION_UNSUPPORTED',
      format,
      `The ${format} encoder cannot preserve the document precision (${String(bitDepth)})`,
    )
  }
  if (format !== 'bigtiff' && transferFunction !== 'srgb') {
    throw new ImageExportCapabilityError(
      'TRANSFER_FUNCTION_UNSUPPORTED',
      format,
      `The ${format} encoder cannot preserve the document transfer function (${String(transferFunction)})`,
    )
  }
}

export function createImageEditSourceFingerprint(envelope: ImageEditDocumentEnvelope): string {
  const payload = JSON.stringify({
    documentId: envelope.documentId,
    revision: envelope.revision,
    resourceRefs: [...envelope.resourceRefs].sort(),
    document: envelope.document,
  })
  return `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`
}
