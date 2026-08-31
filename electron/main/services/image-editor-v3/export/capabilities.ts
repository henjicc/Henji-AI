import type {
  ResourceId,
  TileOutputDescription,
} from '../contracts'
import type { FileTileOutputSinkOptions } from '../tile-output-sink'
import { IMAGE_EDITOR_V3_HDR_AVIF_MAX_PIXELS } from '../../../../../src/platform/contracts/imageEditorV3'

export type RasterExportFormat =
  | 'bigtiff'
  | 'jpeg'
  | 'webp'
  | 'png8'
  | 'png16'
  | 'tiff8'
  | 'tiff16'
  /** High-bit-depth SDR, or the bounded pre-encode Rec.2020 PQ/HLG path. */
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
  | 'ENCODER_RESOURCE_LIMIT'
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

function validateCicpShape(description: TileOutputDescription, format: RasterExportFormat): void {
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
}

function rejectUnsupportedCicp(
  description: TileOutputDescription,
  format: RasterExportFormat,
): void {
  if (!description.cicp) return
  throw capabilityError(
    'CICP_METADATA_UNSUPPORTED',
    format,
    `The ${format} export path cannot reliably preserve CICP metadata`,
  )
}

function validateHdrMetadataShape(description: TileOutputDescription, format: RasterExportFormat): void {
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
}

function isHdrDescription(description: TileOutputDescription): boolean {
  return description.transferFunction === 'pq' || description.transferFunction === 'hlg'
}

function validHdrChromaticity(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const point = value as Record<string, unknown>
  return typeof point.x === 'number'
    && Number.isFinite(point.x)
    && point.x >= 0
    && point.x <= 1
    && typeof point.y === 'number'
    && Number.isFinite(point.y)
    && point.y >= 0
    && point.y <= 1
}

function validHdrBigTiffOptionalMetadata(
  exchange: NonNullable<TileOutputDescription['hdrBigTiffExchange']>,
): boolean {
  const content = exchange.contentLight
  if (content && (!Number.isSafeInteger(content.maxContentLightLevelNits)
    || content.maxContentLightLevelNits < 0
    || content.maxContentLightLevelNits > 65_535
    || !Number.isSafeInteger(content.maxFrameAverageLightLevelNits)
    || content.maxFrameAverageLightLevelNits < 0
    || content.maxFrameAverageLightLevelNits > content.maxContentLightLevelNits)) return false
  const mastering = exchange.masteringDisplay
  return !mastering || (
    validHdrChromaticity(mastering.red)
    && validHdrChromaticity(mastering.green)
    && validHdrChromaticity(mastering.blue)
    && validHdrChromaticity(mastering.whitePoint)
    && Number.isFinite(mastering.maxLuminanceNits)
    && mastering.maxLuminanceNits > 0
    && mastering.maxLuminanceNits <= 10_000
    && Number.isFinite(mastering.minLuminanceNits)
    && mastering.minLuminanceNits >= 0
    && mastering.minLuminanceNits <= mastering.maxLuminanceNits
  )
}

export function validateHdrBigTiffExchange(
  description: Pick<
    TileOutputDescription,
    | 'bitDepth'
    | 'sampleFormat'
    | 'colorSpace'
    | 'transferFunction'
    | 'alphaMode'
    | 'iccProfileResourceId'
    | 'cicp'
    | 'hdrMetadata'
    | 'hdrBigTiffExchange'
  >,
  format: RasterExportFormat,
): boolean {
  const exchange = description.hdrBigTiffExchange
  if (!exchange) return false
  const expectedTransfer = exchange.sourceTransferFunction === 'pq' ? 16 : 18
  const cicp = exchange.sourceCicp
  if (format !== 'bigtiff'
    || exchange.schema !== 'henji-hdr-bigtiff-v1'
    || (exchange.sourceTransferFunction !== 'pq' && exchange.sourceTransferFunction !== 'hlg')
    || description.bitDepth !== 32
    || description.sampleFormat !== 'float'
    || description.colorSpace !== 'rec2020'
    || description.transferFunction !== 'linear'
    || description.alphaMode !== 'straight'
    || description.iccProfileResourceId !== undefined
    || description.cicp !== undefined
    || description.hdrMetadata !== undefined
    || !Number.isFinite(exchange.referenceWhiteNits)
    || exchange.referenceWhiteNits <= 0
    || exchange.referenceWhiteNits > 10_000
    || cicp?.colorPrimaries !== 9
    || cicp?.transferCharacteristics !== expectedTransfer
    || cicp?.matrixCoefficients !== 9
    || cicp?.fullRange !== false
    || !validHdrBigTiffOptionalMetadata(exchange)) {
    throw capabilityError(
      'INVALID_COLOR_METADATA',
      format,
      'HDR BigTIFF exchange requires trusted scene-linear Rec.2020 Float32 samples and matching source CICP metadata',
    )
  }
  return true
}

function validateStreamingHdrAvif(
  description: TileOutputDescription,
  format: RasterExportFormat,
): void {
  if (format !== 'avif10' && format !== 'avif12') {
    throw capabilityError(
      'HDR_METADATA_UNSUPPORTED',
      format,
      `The ${format} export path cannot encode PQ/HLG before writing color metadata`,
    )
  }
  const expectedTransfer = description.transferFunction === 'pq' ? 16 : 18
  const cicp = description.cicp
  if (!cicp
    || cicp.colorPrimaries !== 9
    || cicp.transferCharacteristics !== expectedTransfer
    || cicp.matrixCoefficients !== 9
    || cicp.fullRange) {
    throw capabilityError(
      'INVALID_COLOR_METADATA',
      format,
      'HDR AVIF requires Rec.2020 PQ/HLG, BT.2020 non-constant luminance and limited-range CICP',
    )
  }
  if (description.colorSpace !== 'rec2020' || description.alphaMode !== 'straight') {
    throw capabilityError(
      'INVALID_COLOR_METADATA',
      format,
      'HDR AVIF requires straight-alpha Rec.2020 renderer tiles',
    )
  }
  if (description.iccProfileResourceId) {
    throw capabilityError(
      'HDR_METADATA_UNSUPPORTED',
      format,
      'HDR AVIF cannot yet write an ICC profile alongside the encoder-owned nclx profile',
    )
  }
  if (description.hdrMetadata && Object.values(description.hdrMetadata).some((value) => value !== undefined)) {
    throw capabilityError(
      'HDR_METADATA_UNSUPPORTED',
      format,
      'HDR AVIF mastering-display and content-light metadata are not implemented',
    )
  }
  if (description.width > Math.floor(IMAGE_EDITOR_V3_HDR_AVIF_MAX_PIXELS / description.height)) {
    throw capabilityError(
      'ENCODER_RESOURCE_LIMIT',
      format,
      `HDR AVIF is limited to ${IMAGE_EDITOR_V3_HDR_AVIF_MAX_PIXELS} pixels until tiled AVIF grid encoding is available`,
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
  validateHdrMetadataShape(description, options.format)
  validateCicpShape(description, options.format)
  assertSourcePrecision(description, options.format)

  if (validateHdrBigTiffExchange(description, options.format)) return {}

  if (isHdrDescription(description)) {
    validateStreamingHdrAvif(description, options.format)
    return {}
  }

  if (description.hdrMetadata) {
    throw capabilityError(
      'HDR_METADATA_UNSUPPORTED',
      options.format,
      `The ${options.format} export path cannot preserve HDR metadata on an SDR transfer`,
    )
  }
  rejectUnsupportedCicp(description, options.format)
  validateTransferFunction(description, options.format)

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
