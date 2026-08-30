import type {
  ResourceId,
  TileOutputDescription,
} from '../contracts'
import type { FileTileOutputSinkOptions } from '../tile-output-sink'

export type RasterExportFormat =
  | 'bigtiff'
  | 'jpeg'
  | 'webp'
  | 'png8'
  | 'png16'
  | 'tiff8'
  | 'tiff16'
  /** High-bit-depth SDR only; PQ/HLG output stays unavailable until CICP is preserved reliably. */
  | 'avif10'
  | 'avif12'

export type ImageExportCapabilityErrorCode =
  | 'INVALID_COLOR_METADATA'
  | 'ICC_PROFILE_REQUIRED'
  | 'ICC_PROFILE_UNAVAILABLE'
  | 'ICC_PROFILE_INVALID'
  | 'HDR_METADATA_UNSUPPORTED'
  | 'CICP_METADATA_UNSUPPORTED'
  | 'TRANSFER_FUNCTION_UNSUPPORTED'
  | 'BYTE_ORDER_UNSUPPORTED'
  | 'SOURCE_PRECISION_UNSUPPORTED'
  | 'ENCODER_UNAVAILABLE'

export class ImageExportCapabilityError extends Error {
  override readonly name = 'ImageExportCapabilityError'

  constructor(
    readonly code: ImageExportCapabilityErrorCode,
    readonly format: RasterExportFormat,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export interface RasterExportOptions extends FileTileOutputSinkOptions {
  format: RasterExportFormat
  /** Renderer tiles are transferable bytes, so byte order must never be inferred from the host CPU. */
  inputByteOrder: 'little-endian'
  /** TIFF tile sides must be a multiple of 16. Defaults to the V3 storage tile size (512). */
  tileSize?: number
  compressionLevel?: number
  quality?: number
  effort?: number
  resolveIccProfile?: (resourceId: ResourceId) => Promise<Uint8Array>
}

export interface PreparedExportMetadata {
  iccProfile?: Buffer
}

const MAX_ICC_BYTES = 16 * 1024 * 1024

function capabilityError(
  code: ImageExportCapabilityErrorCode,
  format: RasterExportFormat,
  message: string,
  cause?: unknown,
): ImageExportCapabilityError {
  return new ImageExportCapabilityError(
    code,
    format,
    message,
    cause === undefined ? undefined : { cause },
  )
}

function validateCicp(description: TileOutputDescription, format: RasterExportFormat): void {
  if (!description.cicp) return
  const values = [
    description.cicp.colorPrimaries,
    description.cicp.transferCharacteristics,
    description.cicp.matrixCoefficients,
  ]
  if (
    values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
    || typeof description.cicp.fullRange !== 'boolean'
  ) {
    throw capabilityError('INVALID_COLOR_METADATA', format, 'CICP metadata is invalid')
  }
  throw capabilityError(
    'CICP_METADATA_UNSUPPORTED',
    format,
    `The ${format} export path cannot reliably preserve CICP metadata`,
  )
}

function validateHdrMetadata(description: TileOutputDescription, format: RasterExportFormat): void {
  const metadata = description.hdrMetadata
  if (metadata) {
    const values = Object.values(metadata)
    if (values.some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) {
      throw capabilityError('INVALID_COLOR_METADATA', format, 'HDR mastering metadata is invalid')
    }
    if (
      metadata.minLuminanceNits !== undefined
      && metadata.maxLuminanceNits !== undefined
      && metadata.minLuminanceNits > metadata.maxLuminanceNits
    ) {
      throw capabilityError('INVALID_COLOR_METADATA', format, 'HDR luminance bounds are invalid')
    }
  }
  if (
    description.transferFunction === 'pq'
    || description.transferFunction === 'hlg'
    || metadata
  ) {
    throw capabilityError(
      'HDR_METADATA_UNSUPPORTED',
      format,
      `The ${format} export path cannot reliably preserve PQ/HLG mastering metadata`,
    )
  }
}

function assertSourcePrecision(description: TileOutputDescription, format: RasterExportFormat): void {
  const expected = format === 'jpeg' || format === 'webp' || format === 'png8' || format === 'tiff8'
    ? { bitDepth: 8, sampleFormat: 'uint' as const }
    : format === 'png16' || format === 'tiff16' || format === 'avif10' || format === 'avif12'
      ? { bitDepth: 16, sampleFormat: 'uint' as const }
      : undefined
  if (
    expected
    && (description.bitDepth !== expected.bitDepth || description.sampleFormat !== expected.sampleFormat)
  ) {
    throw capabilityError(
      'SOURCE_PRECISION_UNSUPPORTED',
      format,
      `${format} requires ${expected.bitDepth}-bit unsigned renderer tiles`,
    )
  }
}

function validateTransferFunction(
  description: TileOutputDescription,
  format: RasterExportFormat,
): void {
  if (format !== 'bigtiff' && description.transferFunction !== 'srgb') {
    throw capabilityError(
      'TRANSFER_FUNCTION_UNSUPPORTED',
      format,
      `The ${format} encoder cannot reliably preserve ${description.transferFunction} transfer metadata`,
    )
  }
}

function validateIccBytes(bytes: Uint8Array, format: RasterExportFormat): Buffer {
  if (bytes.byteLength < 128 || bytes.byteLength > MAX_ICC_BYTES) {
    throw capabilityError('ICC_PROFILE_INVALID', format, 'ICC profile size is invalid')
  }
  const profile = Buffer.from(bytes)
  const declaredSize = profile.readUInt32BE(0)
  if (
    declaredSize !== profile.byteLength
    || profile.toString('ascii', 16, 20) !== 'RGB '
    || profile.toString('ascii', 36, 40) !== 'acsp'
  ) {
    throw capabilityError('ICC_PROFILE_INVALID', format, 'ICC profile header is invalid')
  }
  return profile
}

export function validateTileSize(tileSize = 512): number {
  if (
    !Number.isSafeInteger(tileSize)
    || tileSize < 16
    || tileSize > 1024
    || tileSize % 16 !== 0
  ) {
    throw new Error('BigTIFF tile size must be a multiple of 16 between 16 and 1024')
  }
  return tileSize
}

export async function prepareExportMetadata(
  description: TileOutputDescription,
  options: RasterExportOptions,
): Promise<PreparedExportMetadata> {
  if (options.inputByteOrder !== 'little-endian') {
    throw capabilityError(
      'BYTE_ORDER_UNSUPPORTED',
      options.format,
      'V3 raster export currently requires explicitly-declared little-endian samples',
    )
  }
  validateHdrMetadata(description, options.format)
  validateCicp(description, options.format)
  validateTransferFunction(description, options.format)
  assertSourcePrecision(description, options.format)

  if (description.colorSpace !== 'srgb' && !description.iccProfileResourceId) {
    throw capabilityError(
      'ICC_PROFILE_REQUIRED',
      options.format,
      `${description.colorSpace} export requires an explicit ICC profile`,
    )
  }
  if (!description.iccProfileResourceId) return {}
  if (!options.resolveIccProfile) {
    throw capabilityError(
      'ICC_PROFILE_UNAVAILABLE',
      options.format,
      'The ICC profile resolver is unavailable',
    )
  }
  try {
    return {
      iccProfile: validateIccBytes(
        await options.resolveIccProfile(description.iccProfileResourceId),
        options.format,
      ),
    }
  } catch (error) {
    if (error instanceof ImageExportCapabilityError) throw error
    throw capabilityError(
      'ICC_PROFILE_UNAVAILABLE',
      options.format,
      'The ICC profile could not be loaded',
      error,
    )
  }
}
