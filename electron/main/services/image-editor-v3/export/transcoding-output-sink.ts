import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

import type SharpType from 'sharp'

import { loadSharp } from '../../image/sharp-loader'
import type { OutputTile, TileOutputDescription } from '../contracts'
import { readAssociatedNclxCicp } from '../isobmff-cicp'
import { FileTileOutputSinkBase } from '../tile-output-sink'
import {
  ImageExportCapabilityError,
  prepareExportMetadata,
  type RasterExportFormat,
  type RasterExportOptions,
  validateTileSize,
} from './capabilities'
import { IncrementalBigTiffWriter } from './bigtiff-writer'
import {
  requiresStreamingHdrAvifEncoder,
  StreamingHdrAvifEncoder,
} from './hdr-avif-encoder'

type TranscodeFormat = Exclude<RasterExportFormat, 'bigtiff'>
type SharpInstance = ReturnType<typeof SharpType>
type SharpFormatKey = 'jpeg' | 'webp' | 'png' | 'tiff' | 'heif'

export type TranscodingExportOptions = RasterExportOptions & { format: TranscodeFormat }

export interface TranscodingTileOutputSinkDependencies {
  loadFfmpegPath?: () => Promise<string>
}

function createAbortError(): Error {
  const error = new Error('Raster transcoding was cancelled')
  error.name = 'AbortError'
  return error
}

function encoderKey(format: TranscodeFormat): SharpFormatKey {
  if (format === 'jpeg' || format === 'webp') return format
  if (format === 'png8' || format === 'png16') return 'png'
  if (format === 'tiff8' || format === 'tiff16') return 'tiff'
  return 'heif'
}

function validateEncoderOptions(options: RasterExportOptions): void {
  if (
    options.quality !== undefined
    && (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100)
  ) {
    throw new Error('Raster export quality must be an integer between 1 and 100')
  }
  const maxEffort = options.format === 'webp' ? 6 : 9
  if (
    options.effort !== undefined
    && (!Number.isInteger(options.effort) || options.effort < 0 || options.effort > maxEffort)
  ) {
    throw new Error(`Raster export effort must be an integer between 0 and ${maxEffort}`)
  }
}

async function loadRequiredSharp(format: TranscodeFormat): Promise<typeof SharpType> {
  let sharp: typeof SharpType
  try {
    sharp = await loadSharp()
  } catch (error) {
    throw new ImageExportCapabilityError(
      'ENCODER_UNAVAILABLE',
      format,
      'The native raster encoder is unavailable',
      { cause: error },
    )
  }
  if (!sharp.format[encoderKey(format)].output.file) {
    throw new ImageExportCapabilityError(
      'ENCODER_UNAVAILABLE',
      format,
      `The installed libvips build cannot encode ${format}`,
    )
  }
  return sharp
}

function configurePipeline(
  pipeline: SharpInstance,
  options: TranscodingExportOptions,
  tileSize: number,
): SharpInstance {
  if (
    options.format === 'png16'
    || options.format === 'tiff16'
    || options.format === 'avif10'
    || options.format === 'avif12'
  ) {
    pipeline = pipeline.toColourspace('rgb16')
  }
  const quality = options.quality ?? 90
  switch (options.format) {
    case 'jpeg':
      return pipeline
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality, progressive: true })
    case 'webp':
      return pipeline.webp({ quality, effort: options.effort ?? 4, exact: true })
    case 'png8':
    case 'png16':
      return pipeline.png({ compressionLevel: options.compressionLevel ?? 6 })
    case 'tiff8':
    case 'tiff16':
      return pipeline.tiff({
        compression: 'deflate',
        predictor: 'horizontal',
        bigtiff: false,
        tile: true,
        tileWidth: tileSize,
        tileHeight: tileSize,
      })
    case 'avif10':
    case 'avif12':
      return pipeline.avif({
        quality,
        effort: options.effort ?? 4,
        chromaSubsampling: '4:4:4',
        bitdepth: options.format === 'avif10' ? 10 : 12,
      })
  }
}

export class TranscodingTileOutputSink extends FileTileOutputSinkBase {
  private writer: IncrementalBigTiffWriter | undefined
  private intermediatePath: string | undefined
  private pipeline: SharpInstance | undefined
  private hdrEncoder: StreamingHdrAvifEncoder | undefined
  private readonly tileSize: number
  private cancelRequested = false

  constructor(
    targetPath: string,
    private readonly exportOptions: TranscodingExportOptions,
    private readonly dependencies: TranscodingTileOutputSinkDependencies = {},
  ) {
    super(targetPath, exportOptions)
    validateEncoderOptions(exportOptions)
    this.tileSize = validateTileSize(exportOptions.tileSize)
  }

  protected async onBegin(
    stagedPath: string,
    description: TileOutputDescription,
  ): Promise<void> {
    this.cancelRequested = false
    const metadata = await prepareExportMetadata(description, this.exportOptions)
    if (requiresStreamingHdrAvifEncoder(description, this.exportOptions.format)) {
      const encoder = new StreamingHdrAvifEncoder(stagedPath, description, {
        ...this.exportOptions,
        format: this.exportOptions.format,
      }, this.dependencies.loadFfmpegPath)
      this.hdrEncoder = encoder
      await encoder.begin()
      return
    }
    await loadRequiredSharp(this.exportOptions.format)
    const intermediatePath = path.join(
      path.dirname(stagedPath),
      `.${path.basename(stagedPath)}.${crypto.randomUUID()}.source.btf`,
    )
    this.intermediatePath = intermediatePath
    const writer = new IncrementalBigTiffWriter(intermediatePath, {
      tileSize: this.tileSize,
      compressionLevel: this.exportOptions.compressionLevel,
      iccProfile: metadata.iccProfile,
    })
    this.writer = writer
    await writer.begin({
      ...description,
      channels: 4,
      byteOrder: this.exportOptions.inputByteOrder,
    })
  }

  protected async onWriteTile(
    _stagedPath: string,
    tile: OutputTile,
    _description: TileOutputDescription,
  ): Promise<void> {
    if (this.hdrEncoder) {
      await this.hdrEncoder.writeTile(tile)
      return
    }
    if (!this.writer) throw new Error('Transcode source writer has not started')
    await this.writer.writeTile(tile)
  }

  protected async onComplete(
    stagedPath: string,
    _description: TileOutputDescription,
  ): Promise<void> {
    if (this.hdrEncoder) {
      await this.hdrEncoder.complete()
      return
    }
    const writer = this.writer
    const intermediatePath = this.intermediatePath
    if (!writer || !intermediatePath) throw new Error('Transcode source writer has not started')
    await writer.complete()
    try {
      const sharp = await loadRequiredSharp(this.exportOptions.format)
      let pipeline = sharp(intermediatePath, {
        failOn: 'error',
        limitInputPixels: false,
        sequentialRead: true,
      }).keepIccProfile()
      pipeline = configurePipeline(pipeline, this.exportOptions, this.tileSize)
      this.pipeline = pipeline
      await pipeline.toFile(stagedPath)
    } catch (error) {
      if (this.cancelRequested) throw createAbortError()
      throw error
    } finally {
      this.pipeline = undefined
      await this.cleanupIntermediate()
    }
  }

  protected override async verifyStagedFile(
    stagedPath: string,
    description: TileOutputDescription,
  ): Promise<void> {
    const sharp = await loadRequiredSharp(this.exportOptions.format)
    const metadata = await sharp(stagedPath, { limitInputPixels: false }).metadata()
    const expectedFormat = encoderKey(this.exportOptions.format)
    if (
      metadata.format !== expectedFormat
      || metadata.width !== description.width
      || metadata.height !== description.height
    ) {
      throw new Error('Transcoded raster output metadata does not match its snapshot')
    }
    if (
      (this.exportOptions.format === 'png8' || this.exportOptions.format === 'png16')
      && metadata.bitsPerSample !== (this.exportOptions.format === 'png8' ? 8 : 16)
    ) {
      throw new Error(`PNG encoder produced an unexpected bit depth of ${metadata.bitsPerSample ?? metadata.depth}`)
    }
    if (
      (this.exportOptions.format === 'tiff8' || this.exportOptions.format === 'tiff16')
      && metadata.depth !== (this.exportOptions.format === 'tiff8' ? 'uchar' : 'ushort')
    ) {
      throw new Error(`TIFF encoder produced an unexpected sample format of ${metadata.depth}`)
    }
    if (
      (this.exportOptions.format === 'avif10' || this.exportOptions.format === 'avif12')
      && metadata.bitsPerSample !== (this.exportOptions.format === 'avif10' ? 10 : 12)
    ) {
      throw new Error(`AVIF encoder silently reduced the requested bit depth to ${metadata.bitsPerSample ?? metadata.depth}`)
    }
    if (requiresStreamingHdrAvifEncoder(description, this.exportOptions.format)) {
      if (!metadata.hasAlpha) throw new Error('HDR AVIF encoder dropped the alpha auxiliary image')
      const actualCicp = await readAssociatedNclxCicp(stagedPath, 'avif')
      const expectedCicp = description.cicp
      if (!actualCicp || !expectedCicp
        || actualCicp.colorPrimaries !== expectedCicp.colorPrimaries
        || actualCicp.transferCharacteristics !== expectedCicp.transferCharacteristics
        || actualCicp.matrixCoefficients !== expectedCicp.matrixCoefficients
        || actualCicp.fullRange !== expectedCicp.fullRange) {
        throw new Error('HDR AVIF encoder produced a mismatched nclx color contract')
      }
    }
  }

  protected override async onCancel(): Promise<void> {
    this.cancelRequested = true
    await this.hdrEncoder?.cancel()
    this.pipeline?.destroy()
    await this.writer?.cancel()
    await this.cleanupIntermediate()
  }

  private async cleanupIntermediate(): Promise<void> {
    const intermediatePath = this.intermediatePath
    this.intermediatePath = undefined
    if (intermediatePath) await fsp.rm(intermediatePath, { force: true }).catch(() => undefined)
  }
}
