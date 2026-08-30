import type { FileHandle } from 'node:fs/promises'
import fsp from 'node:fs/promises'
import { deflate } from 'node:zlib'

import type { OutputTile } from '../contracts'
import {
  buildBigTiffDirectory,
  type BigTiffDirectory,
  type BigTiffRasterDescription,
} from './bigtiff-layout'

type WriterState = 'idle' | 'starting' | 'writing' | 'completing' | 'completed' | 'cancelled' | 'failed'

export interface IncrementalBigTiffWriterOptions {
  tileSize: number
  compressionLevel?: number
  iccProfile?: Uint8Array
}

function createAbortError(): Error {
  const error = new Error('BigTIFF encoding was cancelled')
  error.name = 'AbortError'
  return error
}

function compressTile(tile: Buffer, level: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    deflate(tile, { level }, (error, compressed) => {
      if (error) reject(error)
      else resolve(compressed)
    })
  })
}

async function writeAll(handle: FileHandle, bytes: Buffer, position: number): Promise<void> {
  let sourceOffset = 0
  while (sourceOffset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      sourceOffset,
      bytes.byteLength - sourceOffset,
      position + sourceOffset,
    )
    if (bytesWritten < 1) throw new Error('BigTIFF file write made no progress')
    sourceOffset += bytesWritten
  }
}

/**
 * Writes one independently-compressed physical TIFF tile at a time. Pixel data is never
 * accumulated across tiles; only the bounded IFD arrays and one padded edge tile are resident.
 */
export class IncrementalBigTiffWriter {
  private state: WriterState = 'idle'
  private handle: FileHandle | undefined
  private directory: BigTiffDirectory | undefined
  private description: BigTiffRasterDescription | undefined
  private nextTileIndex = 0
  private nextDataOffset = 0
  private activeOperation: Promise<void> | undefined

  constructor(
    readonly outputPath: string,
    private readonly options: IncrementalBigTiffWriterOptions,
  ) {}

  async begin(description: BigTiffRasterDescription): Promise<void> {
    if (this.state !== 'idle') throw new Error(`Cannot begin BigTIFF writer while ${this.state}`)
    this.validateDescription(description)
    this.state = 'starting'
    const operation = this.beginInternal(description)
    this.activeOperation = operation
    try {
      await operation
      this.assertNotCancelled()
      this.state = 'writing'
    } catch (error) {
      if (!this.isCancelled()) this.state = 'failed'
      await this.closeHandle()
      throw error
    } finally {
      if (this.activeOperation === operation) this.activeOperation = undefined
    }
  }

  async writeTile(tile: OutputTile): Promise<void> {
    if (this.state !== 'writing' || !this.directory || !this.description || !this.handle) {
      throw new Error(`Cannot write BigTIFF tile while ${this.state}`)
    }
    if (this.activeOperation) throw new Error('Concurrent BigTIFF writes are not allowed')
    const operation = this.writeTileInternal(tile, this.directory, this.description, this.handle)
    this.activeOperation = operation
    try {
      await operation
      this.assertNotCancelled()
    } catch (error) {
      if (!this.isCancelled()) this.state = 'failed'
      throw error
    } finally {
      if (this.activeOperation === operation) this.activeOperation = undefined
    }
  }

  async complete(): Promise<void> {
    if (this.state !== 'writing' || !this.directory || !this.handle) {
      throw new Error(`Cannot complete BigTIFF writer while ${this.state}`)
    }
    if (this.nextTileIndex !== this.directory.plan.tileCount) {
      throw new Error('BigTIFF tile grid is incomplete')
    }
    this.state = 'completing'
    const operation = this.syncAndClose(this.handle)
    this.activeOperation = operation
    try {
      await operation
      this.assertNotCancelled()
      this.handle = undefined
      this.state = 'completed'
    } catch (error) {
      if (!this.isCancelled()) this.state = 'failed'
      await this.closeHandle()
      throw error
    } finally {
      if (this.activeOperation === operation) this.activeOperation = undefined
    }
  }

  async cancel(): Promise<void> {
    if (this.state === 'completed' || this.state === 'cancelled') return
    this.state = 'cancelled'
    await this.activeOperation?.catch(() => undefined)
    await this.closeHandle()
  }

  private async beginInternal(description: BigTiffRasterDescription): Promise<void> {
    const directory = buildBigTiffDirectory(
      description,
      this.options.tileSize,
      this.options.iccProfile,
    )
    const handle = await fsp.open(this.outputPath, 'wx+')
    this.handle = handle
    this.assertNotCancelled()
    await writeAll(handle, directory.bytes, 0)
    this.assertNotCancelled()
    this.description = { ...description }
    this.directory = directory
    this.nextDataOffset = directory.dataOffset
  }

  private async writeTileInternal(
    tile: OutputTile,
    directory: BigTiffDirectory,
    description: BigTiffRasterDescription,
    handle: FileHandle,
  ): Promise<void> {
    const { plan } = directory
    const column = this.nextTileIndex % plan.columns
    const row = Math.floor(this.nextTileIndex / plan.columns)
    const expectedX = column * plan.tileSize
    const expectedY = row * plan.tileSize
    const expectedWidth = Math.min(plan.tileSize, description.width - expectedX)
    const expectedHeight = Math.min(plan.tileSize, description.height - expectedY)
    if (
      tile.x !== expectedX
      || tile.y !== expectedY
      || tile.width !== expectedWidth
      || tile.height !== expectedHeight
    ) {
      throw new Error('BigTIFF tiles must use the planned fixed grid in scanline order')
    }
    const packedRowBytes = tile.width * plan.bytesPerPixel
    if (tile.rowStride < packedRowBytes || tile.pixels.byteLength < tile.rowStride * tile.height) {
      throw new Error('BigTIFF tile buffer is smaller than its declared layout')
    }
    const uncompressed = this.createPhysicalTile(tile, plan.bytesPerPixel, plan.tileSize)
    const compressed = await compressTile(uncompressed, this.options.compressionLevel ?? 6)
    this.assertNotCancelled()
    if (compressed.byteLength > plan.maxCompressedTileBytes) {
      throw new Error('Compressed BigTIFF tile exceeded its bounded allocation plan')
    }
    if (!Number.isSafeInteger(this.nextDataOffset + compressed.byteLength)) {
      throw new Error('BigTIFF file offset exceeds the safe file API range')
    }
    await writeAll(handle, compressed, this.nextDataOffset)
    this.assertNotCancelled()
    const tileOffset = Buffer.allocUnsafe(8)
    const tileByteCount = Buffer.allocUnsafe(8)
    tileOffset.writeBigUInt64LE(BigInt(this.nextDataOffset))
    tileByteCount.writeBigUInt64LE(BigInt(compressed.byteLength))
    await writeAll(
      handle,
      tileOffset,
      directory.tileOffsetsPatchOffset + this.nextTileIndex * 8,
    )
    await writeAll(
      handle,
      tileByteCount,
      directory.tileByteCountsPatchOffset + this.nextTileIndex * 8,
    )
    this.nextDataOffset += compressed.byteLength
    this.nextTileIndex += 1
  }

  private createPhysicalTile(tile: OutputTile, bytesPerPixel: number, tileSize: number): Buffer {
    const source = Buffer.from(tile.pixels.buffer, tile.pixels.byteOffset, tile.pixels.byteLength)
    const physicalRowBytes = tileSize * bytesPerPixel
    if (
      tile.width === tileSize
      && tile.height === tileSize
      && tile.rowStride === physicalRowBytes
    ) {
      return source.subarray(0, tile.rowStride * tile.height)
    }
    const physical = Buffer.alloc(physicalRowBytes * tileSize)
    const packedRowBytes = tile.width * bytesPerPixel
    for (let row = 0; row < tile.height; row += 1) {
      source.copy(
        physical,
        row * physicalRowBytes,
        row * tile.rowStride,
        row * tile.rowStride + packedRowBytes,
      )
    }
    return physical
  }

  private validateDescription(description: BigTiffRasterDescription): void {
    if (description.channels !== 3 && description.channels !== 4) {
      throw new Error('BigTIFF output must use RGB or RGBA samples')
    }
    if (![8, 16, 32].includes(description.bitDepth)) {
      throw new Error('BigTIFF bit depth must be 8, 16 or 32')
    }
    if (description.sampleFormat !== 'uint' && description.sampleFormat !== 'float') {
      throw new Error('BigTIFF sample format must be uint or float')
    }
    if (description.byteOrder !== 'little-endian') {
      throw new Error('BigTIFF input samples must explicitly use little-endian byte order')
    }
    if (!['srgb', 'display-p3', 'rec2020'].includes(description.colorSpace)) {
      throw new Error('BigTIFF color space is unsupported')
    }
    if (!['srgb', 'linear', 'pq', 'hlg'].includes(description.transferFunction)) {
      throw new Error('BigTIFF transfer function is unsupported')
    }
    if (description.transferFunction === 'pq' || description.transferFunction === 'hlg') {
      throw new Error('BigTIFF cannot reliably preserve PQ/HLG metadata')
    }
    if (description.colorSpace !== 'srgb' && !this.options.iccProfile) {
      throw new Error(`${description.colorSpace} BigTIFF output requires an ICC profile`)
    }
    if (description.sampleFormat === 'float' && description.bitDepth !== 32) {
      throw new Error('Floating-point BigTIFF samples must be 32-bit')
    }
    if (description.sampleFormat === 'uint' && description.bitDepth === 32) {
      throw new Error('32-bit BigTIFF samples must be floating-point')
    }
    if (
      description.channels === 4
      && description.alphaMode !== 'straight'
      && description.alphaMode !== 'premultiplied'
    ) {
      throw new Error('RGBA BigTIFF output requires an alpha mode')
    }
    if (!Number.isSafeInteger(description.revision) || description.revision < 0) {
      throw new Error('BigTIFF document revision must be a non-negative safe integer')
    }
    if (!/^[\x20-\x7e]+$/.test(description.documentId) || description.documentId.length > 4096) {
      throw new Error('BigTIFF document ID must be bounded printable ASCII')
    }
    if (
      description.sourceFingerprint !== undefined
      && (!/^[\x20-\x7e]+$/.test(description.sourceFingerprint)
        || description.sourceFingerprint.length > 4096)
    ) {
      throw new Error('BigTIFF source fingerprint must be bounded printable ASCII')
    }
    const level = this.options.compressionLevel ?? 6
    if (!Number.isInteger(level) || level < 0 || level > 9) {
      throw new Error('BigTIFF deflate level must be between 0 and 9')
    }
  }

  private assertNotCancelled(): void {
    if (this.isCancelled()) throw createAbortError()
  }

  private isCancelled(): boolean {
    return this.state === 'cancelled'
  }

  private async syncAndClose(handle: FileHandle): Promise<void> {
    await handle.sync()
    await handle.close()
  }

  private async closeHandle(): Promise<void> {
    const handle = this.handle
    this.handle = undefined
    if (handle) await handle.close().catch(() => undefined)
  }
}
