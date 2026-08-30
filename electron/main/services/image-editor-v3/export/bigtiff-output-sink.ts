import fsp from 'node:fs/promises'

import type { OutputTile, TileOutputDescription } from '../contracts'
import { FileTileOutputSinkBase } from '../tile-output-sink'
import {
  prepareExportMetadata,
  type RasterExportOptions,
  validateTileSize,
} from './capabilities'
import { IncrementalBigTiffWriter } from './bigtiff-writer'

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

  protected override async verifyStagedFile(stagedPath: string): Promise<void> {
    const handle = await fsp.open(stagedPath, 'r')
    try {
      const header = Buffer.alloc(16)
      const { bytesRead } = await handle.read(header, 0, header.byteLength, 0)
      if (
        bytesRead !== header.byteLength
        || header.toString('ascii', 0, 2) !== 'II'
        || header.readUInt16LE(2) !== 43
        || header.readUInt16LE(4) !== 8
        || header.readUInt16LE(6) !== 0
      ) {
        throw new Error('Encoded BigTIFF header is invalid')
      }
    } finally {
      await handle.close()
    }
  }

  protected override async onCancel(): Promise<void> {
    await this.writer?.cancel()
  }
}
