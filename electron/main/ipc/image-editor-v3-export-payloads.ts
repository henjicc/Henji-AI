import {
  parseDocumentRef,
  type RasterExportFormat,
  type RasterExportPixelDescription,
} from '../services/image-editor-v3'
import { parseRecord } from './registry'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/
const SESSION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const SOURCE_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/
const RESOURCE_REF_PATTERN = /^sha256:[a-f0-9]{64}$/
const MAX_EXPORT_DIMENSION = 1_000_000
const MAX_EXPORT_PIXELS = 400_000_000
const MAX_TILE_SIDE = 1_024
const MAX_TILE_BYTES = 16 * 1024 * 1024

const RASTER_EXPORT_FORMATS = new Set<RasterExportFormat>([
  'bigtiff', 'jpeg', 'webp', 'png8', 'png16', 'tiff8', 'tiff16', 'avif10', 'avif12',
])

function assertAllowedKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key))
  if (unexpected.length > 0) {
    throw new Error(`Invalid ${context}; unsupported fields: ${unexpected.join(', ')}`)
  }
}

export interface StartRasterExportPayload {
  requestId: string
  documentRef: string
  revision: number
  sourceFingerprint: string
  format: RasterExportFormat
  description: RasterExportPixelDescription
  suggestedName?: string
  tileSize?: number
  compressionLevel?: number
  quality?: number
  effort?: number
}

export interface RasterExportSessionPayload { sessionId: string }

export interface WriteRasterExportTilePayload extends RasterExportSessionPayload {
  tile: {
    x: number
    y: number
    width: number
    height: number
    rowStride: number
    pixels: Uint8Array
  }
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${field}`)
  return value
}

function readInteger(
  record: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const value = record[field]
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Invalid ${field}`)
  }
  return value as number
}

function readOptionalInteger(
  record: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  return record[field] === undefined ? undefined : readInteger(record, field, minimum, maximum)
}

function readEnum<T extends string>(
  record: Record<string, unknown>,
  field: string,
  values: readonly T[],
): T {
  const value = record[field]
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${field}`)
  }
  return value as T
}

function readResourceRef(record: Record<string, unknown>, field: string): `sha256:${string}` | undefined {
  const value = record[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !RESOURCE_REF_PATTERN.test(value)) throw new Error(`Invalid ${field}`)
  return value as `sha256:${string}`
}

function parseCicp(value: unknown): RasterExportPixelDescription['cicp'] {
  if (value === undefined || value === null) return undefined
  const record = parseRecord(value)
  assertAllowedKeys(record, [
    'colorPrimaries', 'transferCharacteristics', 'matrixCoefficients', 'fullRange',
  ], 'raster export CICP metadata')
  const fullRange = record.fullRange
  if (typeof fullRange !== 'boolean') throw new Error('Invalid raster export CICP metadata')
  return {
    colorPrimaries: readInteger(record, 'colorPrimaries', 0, 255),
    transferCharacteristics: readInteger(record, 'transferCharacteristics', 0, 255),
    matrixCoefficients: readInteger(record, 'matrixCoefficients', 0, 255),
    fullRange,
  }
}

function parseHdrMetadata(value: unknown): RasterExportPixelDescription['hdrMetadata'] {
  if (value === undefined || value === null) return undefined
  const record = parseRecord(value)
  assertAllowedKeys(record, [
    'maxLuminanceNits', 'minLuminanceNits',
    'maxContentLightLevelNits', 'maxFrameAverageLightLevelNits',
  ], 'raster export HDR metadata')
  const result: NonNullable<RasterExportPixelDescription['hdrMetadata']> = {}
  for (const field of [
    'maxLuminanceNits',
    'minLuminanceNits',
    'maxContentLightLevelNits',
    'maxFrameAverageLightLevelNits',
  ] as const) {
    const fieldValue = record[field]
    if (fieldValue === undefined) continue
    if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue) || fieldValue < 0) {
      throw new Error(`Invalid raster export ${field}`)
    }
    result[field] = fieldValue
  }
  return result
}

function parseDescription(value: unknown): RasterExportPixelDescription {
  const record = parseRecord(value)
  assertAllowedKeys(record, [
    'width', 'height', 'bitDepth', 'sampleFormat', 'colorSpace', 'transferFunction',
    'alphaMode', 'iccProfileResourceRef', 'cicp', 'hdrMetadata',
  ], 'raster export description')
  const width = readInteger(record, 'width', 1, MAX_EXPORT_DIMENSION)
  const height = readInteger(record, 'height', 1, MAX_EXPORT_DIMENSION)
  if (width > Math.floor(MAX_EXPORT_PIXELS / height)) {
    throw new Error(`Raster export exceeds ${MAX_EXPORT_PIXELS} pixels`)
  }
  const bitDepth = record.bitDepth
  if (bitDepth !== 8 && bitDepth !== 16 && bitDepth !== 32) {
    throw new Error('Invalid bitDepth')
  }
  return {
    width,
    height,
    channels: 4,
    bitDepth,
    sampleFormat: readEnum(record, 'sampleFormat', ['uint', 'float'] as const),
    colorSpace: readEnum(record, 'colorSpace', ['srgb', 'display-p3', 'rec2020'] as const),
    transferFunction: readEnum(record, 'transferFunction', ['srgb', 'linear', 'pq', 'hlg'] as const),
    alphaMode: readEnum(record, 'alphaMode', ['straight', 'premultiplied'] as const),
    iccProfileResourceId: readResourceRef(record, 'iccProfileResourceRef'),
    cicp: parseCicp(record.cicp),
    hdrMetadata: parseHdrMetadata(record.hdrMetadata),
  }
}

export function parseImageEditorV3StartRasterExportPayload(input: unknown): StartRasterExportPayload {
  const record = parseRecord(input)
  assertAllowedKeys(record, [
    'requestId', 'documentRef', 'revision', 'sourceFingerprint', 'format', 'description',
    'suggestedName', 'tileSize', 'compressionLevel', 'quality', 'effort',
  ], 'raster export request')
  const requestId = readString(record, 'requestId')
  const documentRef = readString(record, 'documentRef')
  const sourceFingerprint = readString(record, 'sourceFingerprint')
  const format = readString(record, 'format') as RasterExportFormat
  const suggestedName = record.suggestedName
  if (!REQUEST_ID_PATTERN.test(requestId)) throw new Error('Invalid requestId')
  parseDocumentRef(documentRef)
  if (!SOURCE_FINGERPRINT_PATTERN.test(sourceFingerprint)) throw new Error('Invalid sourceFingerprint')
  if (!RASTER_EXPORT_FORMATS.has(format)) throw new Error('Invalid raster export format')
  if (suggestedName !== undefined && (typeof suggestedName !== 'string' || suggestedName.length > 160)) {
    throw new Error('Invalid suggestedName')
  }
  const tileSize = readOptionalInteger(record, 'tileSize', 16, MAX_TILE_SIDE)
  if (tileSize !== undefined && tileSize % 16 !== 0) throw new Error('Invalid tileSize')
  return {
    requestId,
    documentRef,
    revision: readInteger(record, 'revision', 0, Number.MAX_SAFE_INTEGER),
    sourceFingerprint,
    format,
    description: parseDescription(record.description),
    suggestedName,
    tileSize,
    compressionLevel: readOptionalInteger(record, 'compressionLevel', 0, 9),
    quality: readOptionalInteger(record, 'quality', 1, 100),
    effort: readOptionalInteger(record, 'effort', 0, 9),
  }
}

export function parseImageEditorV3RasterExportSessionPayload(
  input: unknown,
): RasterExportSessionPayload {
  const record = parseRecord(input)
  assertAllowedKeys(record, ['sessionId'], 'raster export session request')
  const sessionId = readString(record, 'sessionId')
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error('Invalid raster export sessionId')
  return { sessionId }
}

export function parseImageEditorV3WriteRasterExportTilePayload(
  input: unknown,
): WriteRasterExportTilePayload {
  const record = parseRecord(input)
  assertAllowedKeys(record, ['sessionId', 'tile'], 'raster export tile request')
  const sessionId = readString(record, 'sessionId')
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error('Invalid raster export sessionId')
  const tile = parseRecord(record.tile)
  assertAllowedKeys(tile, ['x', 'y', 'width', 'height', 'rowStride', 'pixels'], 'raster export tile')
  const width = readInteger(tile, 'width', 1, MAX_TILE_SIDE)
  const height = readInteger(tile, 'height', 1, MAX_TILE_SIDE)
  const rowStride = readInteger(tile, 'rowStride', 1, MAX_TILE_BYTES)
  const rawPixels = tile.pixels
  let pixels: Uint8Array
  if (rawPixels instanceof ArrayBuffer) {
    pixels = new Uint8Array(rawPixels)
  } else if (rawPixels instanceof Uint8Array && rawPixels.buffer instanceof ArrayBuffer) {
    pixels = new Uint8Array(rawPixels.buffer, rawPixels.byteOffset, rawPixels.byteLength)
  } else {
    throw new Error('Invalid raster export tile pixels')
  }
  if (pixels.byteLength < 1 || pixels.byteLength > MAX_TILE_BYTES
    || pixels.byteLength !== rowStride * height) {
    throw new Error('Raster export tile byte length does not match its row layout')
  }
  return {
    sessionId,
    tile: {
      x: readInteger(tile, 'x', 0, Number.MAX_SAFE_INTEGER),
      y: readInteger(tile, 'y', 0, Number.MAX_SAFE_INTEGER),
      width,
      height,
      rowStride,
      pixels,
    },
  }
}
