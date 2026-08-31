import crypto from 'node:crypto'

import type { ImageEditDocumentEnvelope, TileOutputDescription } from './contracts'
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

type HdrBigTiffExchange = NonNullable<TileOutputDescription['hdrBigTiffExchange']>

function invalidHdrExchangeMetadata(format: RasterExportFormat, message: string): never {
  throw new ImageExportCapabilityError('INVALID_COLOR_METADATA', format, message)
}

function readHdrContentLight(
  value: unknown,
  format: RasterExportFormat,
): HdrBigTiffExchange['contentLight'] | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    return invalidHdrExchangeMetadata(format, 'HDR content-light metadata is invalid')
  }
  const maxContentLightLevelNits = value.maxContentLightLevelNits
  const maxFrameAverageLightLevelNits = value.maxFrameAverageLightLevelNits
  if (!Number.isSafeInteger(maxContentLightLevelNits)
    || (maxContentLightLevelNits as number) < 0
    || (maxContentLightLevelNits as number) > 65_535
    || !Number.isSafeInteger(maxFrameAverageLightLevelNits)
    || (maxFrameAverageLightLevelNits as number) < 0
    || (maxFrameAverageLightLevelNits as number) > (maxContentLightLevelNits as number)) {
    return invalidHdrExchangeMetadata(format, 'HDR content-light metadata is invalid')
  }
  return {
    maxContentLightLevelNits: maxContentLightLevelNits as number,
    maxFrameAverageLightLevelNits: maxFrameAverageLightLevelNits as number,
  }
}

function readHdrChromaticity(
  value: unknown,
  format: RasterExportFormat,
  label: string,
): { x: number; y: number } {
  if (!isRecord(value)
    || typeof value.x !== 'number'
    || !Number.isFinite(value.x)
    || value.x < 0
    || value.x > 1
    || typeof value.y !== 'number'
    || !Number.isFinite(value.y)
    || value.y < 0
    || value.y > 1) {
    return invalidHdrExchangeMetadata(format, `HDR mastering-display ${label} is invalid`)
  }
  return { x: value.x, y: value.y }
}

function readHdrMasteringDisplay(
  value: unknown,
  format: RasterExportFormat,
): HdrBigTiffExchange['masteringDisplay'] | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    return invalidHdrExchangeMetadata(format, 'HDR mastering-display metadata is invalid')
  }
  const maxLuminanceNits = value.maxLuminanceNits
  const minLuminanceNits = value.minLuminanceNits
  if (typeof maxLuminanceNits !== 'number'
    || !Number.isFinite(maxLuminanceNits)
    || maxLuminanceNits <= 0
    || maxLuminanceNits > 10_000
    || typeof minLuminanceNits !== 'number'
    || !Number.isFinite(minLuminanceNits)
    || minLuminanceNits < 0
    || minLuminanceNits > maxLuminanceNits) {
    return invalidHdrExchangeMetadata(format, 'HDR mastering-display luminance is invalid')
  }
  return {
    red: readHdrChromaticity(value.red, format, 'red primary'),
    green: readHdrChromaticity(value.green, format, 'green primary'),
    blue: readHdrChromaticity(value.blue, format, 'blue primary'),
    whitePoint: readHdrChromaticity(value.whitePoint, format, 'white point'),
    maxLuminanceNits,
    minLuminanceNits,
  }
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
): Pick<TileOutputDescription, 'hdrBigTiffExchange'> {
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
    if (workingSpace !== 'rec2020'
      || !hasHdrSourcePrecision
      || !isRecord(hdrMetadata)
      || hdrMetadata.standard !== transferFunction
      || typeof hdrMetadata.referenceWhiteNits !== 'number'
      || !Number.isFinite(hdrMetadata.referenceWhiteNits)
      || hdrMetadata.referenceWhiteNits <= 0
      || hdrMetadata.referenceWhiteNits > 10_000
      || !isRecord(hdrMetadata.cicp)) {
      throw new ImageExportCapabilityError(
        'HDR_METADATA_UNSUPPORTED',
        format,
        'HDR export requires a 16-bit or floating-point Rec.2020 document with matching PQ/HLG metadata',
      )
    }
    const cicp = hdrMetadata.cicp
    const expectedTransfer = transferFunction === 'pq' ? 16 : 18
    if (cicp.colorPrimaries !== 9
      || cicp.transferCharacteristics !== expectedTransfer
      || cicp.matrixCoefficients !== 9
      || cicp.fullRange !== false) {
      throw new ImageExportCapabilityError(
        'INVALID_COLOR_METADATA',
        format,
        'HDR document CICP metadata is invalid',
      )
    }
    if (iccProfileResourceId !== null || description.iccProfileResourceId !== undefined) {
      throw new ImageExportCapabilityError(
        'INVALID_COLOR_METADATA',
        format,
        'HDR export cannot mix the document CICP contract with an unrelated ICC profile',
      )
    }
    if (format === 'bigtiff') {
      if (description.bitDepth !== 32
        || description.sampleFormat !== 'float'
        || description.colorSpace !== 'rec2020'
        || description.transferFunction !== 'linear'
        || description.alphaMode !== 'straight'
        || description.cicp !== undefined
        || description.hdrMetadata !== undefined) {
        throw new ImageExportCapabilityError(
          'INVALID_COLOR_METADATA',
          format,
          'HDR BigTIFF requires straight-alpha scene-linear Rec.2020 Float32 renderer tiles',
        )
      }
      const contentLight = readHdrContentLight(hdrMetadata.contentLight, format)
      const masteringDisplay = readHdrMasteringDisplay(hdrMetadata.masteringDisplay, format)
      return {
        hdrBigTiffExchange: {
          schema: 'henji-hdr-bigtiff-v1',
          sourceTransferFunction: transferFunction,
          referenceWhiteNits: hdrMetadata.referenceWhiteNits,
          sourceCicp: {
            colorPrimaries: 9,
            transferCharacteristics: expectedTransfer,
            matrixCoefficients: 9,
            fullRange: false,
          },
          ...(contentLight ? { contentLight } : {}),
          ...(masteringDisplay ? { masteringDisplay } : {}),
        },
      }
    }
    if (format !== 'avif10' && format !== 'avif12') {
      throw new ImageExportCapabilityError(
        'HDR_METADATA_UNSUPPORTED',
        format,
        'PQ/HLG documents can currently be exported only as HDR AVIF or linear Float32 BigTIFF',
      )
    }
    if (description.cicp?.colorPrimaries !== cicp.colorPrimaries
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
      || description.alphaMode !== 'straight') {
      throw new ImageExportCapabilityError(
        'INVALID_COLOR_METADATA',
        format,
        'Raster export pixels do not match the HDR document color contract',
      )
    }
    return {}
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
  return {}
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
