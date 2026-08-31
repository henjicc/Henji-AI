import fsp from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'

import type { OutputTile, TileOutputDescription } from '../contracts'
import { FileTileOutputSinkBase } from '../tile-output-sink'
import {
  prepareExportMetadata,
  type RasterExportOptions,
  validateTileSize,
} from './capabilities'
import { IncrementalBigTiffWriter } from './bigtiff-writer'
import { createBigTiffEmbeddedRasterMetadataV3 } from './bigtiff-layout'
import { readBigTiffEmbeddedRasterMetadataV3 } from './bigtiff-metadata-reader'

export type BigTiffOutputSinkOptions = Omit<RasterExportOptions, 'format'>

export class BigTiffTileOutputSink extends FileTileOutputSinkBase {
  private writer: IncrementalBigTiffWriter | undefined
  private readonly exportOptions: RasterExportOptions

  constructor(targetPath: string, options: BigTiffOutputSinkOptions) {
    super(targetPath, options)
    this.exportOptions = { ...options, format: 'bigtiff' }
  }

  protected async onBegin(
    stagedPath: string,
    description: TileOutputDescription,
  ): Promise<void> {
    const metadata = await prepareExportMetadata(description, this.exportOptions)
    const writer = new IncrementalBigTiffWriter(stagedPath, {
      tileSize: validateTileSize(this.exportOptions.tileSize),
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
    if (!this.writer) throw new Error('BigTIFF writer has not started')
    await this.writer.writeTile(tile)
  }

  protected async onComplete(
    _stagedPath: string,
    _description: TileOutputDescription,
  ): Promise<void> {
    if (!this.writer) throw new Error('BigTIFF writer has not started')
    await this.writer.complete()
  }

  protected override async verifyStagedFile(
    stagedPath: string,
    description: TileOutputDescription,
  ): Promise<void> {
    const handle = await fsp.open(stagedPath, 'r')
    try {
      const actual = await readBigTiffEmbeddedRasterMetadataV3(handle)
      const expected = createBigTiffEmbeddedRasterMetadataV3({
        ...description,
        channels: 4,
        byteOrder: this.exportOptions.inputByteOrder,
      })
      if (!isDeepStrictEqual(actual, JSON.parse(JSON.stringify(expected)))) {
        throw new Error('Encoded BigTIFF image-edit metadata does not match the export snapshot')
      }
    } finally {
      await handle.close()
    }
  }

  protected override async onCancel(): Promise<void> {
    await this.writer?.cancel()
  }
}
