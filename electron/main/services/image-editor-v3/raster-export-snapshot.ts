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
  if (transferFunction === 'pq' || transferFunction === 'hlg' || hdrMetadata !== null) {
    throw new ImageExportCapabilityError(
      'HDR_METADATA_UNSUPPORTED',
      format,
      'HDR raster export is unavailable because the encoder cannot reliably preserve PQ/HLG metadata',
    )
  }
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
