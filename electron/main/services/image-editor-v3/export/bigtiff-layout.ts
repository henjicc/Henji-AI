import type { TileOutputDescription } from '../contracts'

const BIG_TIFF_HEADER_BYTES = 16
const BIG_TIFF_IFD_COUNT_BYTES = 8
const BIG_TIFF_IFD_ENTRY_BYTES = 20
const BIG_TIFF_NEXT_IFD_BYTES = 8
const MAX_TILE_COUNT = 1_000_000

const enum TiffType {
  Ascii = 2,
  Short = 3,
  Long = 4,
  Undefined = 7,
  Long8 = 16,
}

interface TiffTag {
  key?: 'tileOffsets' | 'tileByteCounts'
  tag: number
  type: TiffType
  count: number
  value: Buffer
}

export interface BigTiffRasterDescription {
  width: number
  height: number
  channels: 3 | 4
  bitDepth: 8 | 16 | 32
  sampleFormat: 'uint' | 'float'
  byteOrder: 'little-endian'
  colorSpace: TileOutputDescription['colorSpace']
  transferFunction: TileOutputDescription['transferFunction']
  alphaMode?: TileOutputDescription['alphaMode']
  documentId: string
  revision: number
  sourceFingerprint?: string
}

export interface BigTiffPlan {
  tileSize: number
  columns: number
  rows: number
  tileCount: number
  bytesPerSample: number
  bytesPerPixel: number
  maxUncompressedTileBytes: number
  maxCompressedTileBytes: number
  maxWorkingSetBytes: number
  metadataUpperBoundBytes: number
}

export interface BigTiffDirectory {
  bytes: Buffer
  dataOffset: number
  tileOffsetsPatchOffset: number
  tileByteCountsPatchOffset: number
  plan: BigTiffPlan
}

function align8(value: number): number {
  return Math.ceil(value / 8) * 8
}

function shortValues(values: readonly number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2)
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2))
  return buffer
}

function longValue(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value)
  return buffer
}

function asciiValue(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf8')
}

function deflateBound(byteLength: number): number {
  return byteLength
    + Math.floor(byteLength / 4096)
    + Math.floor(byteLength / 16_384)
    + Math.floor(byteLength / 33_554_432)
    + 13
}

export function planBigTiff(
  description: Pick<BigTiffRasterDescription, 'width' | 'height' | 'channels' | 'bitDepth'>,
  tileSize = 512,
  iccByteLength = 0,
): BigTiffPlan {
  if (
    !Number.isSafeInteger(description.width)
    || !Number.isSafeInteger(description.height)
    || description.width < 1
    || description.height < 1
    || description.width > 0xffff_ffff
    || description.height > 0xffff_ffff
  ) {
    throw new Error('BigTIFF dimensions must fit unsigned 32-bit TIFF dimension tags')
  }
  if (
    !Number.isSafeInteger(tileSize)
    || tileSize < 16
    || tileSize > 1024
    || tileSize % 16 !== 0
  ) {
    throw new Error('BigTIFF tile size must be a multiple of 16 between 16 and 1024')
  }
  const columns = Math.ceil(description.width / tileSize)
  const rows = Math.ceil(description.height / tileSize)
  const tileCount = columns * rows
  if (!Number.isSafeInteger(tileCount) || tileCount > MAX_TILE_COUNT) {
    throw new Error('BigTIFF tile directory exceeds the bounded metadata limit')
  }
  const bytesPerSample = description.bitDepth / 8
  const bytesPerPixel = bytesPerSample * description.channels
  const maxUncompressedTileBytes = tileSize * tileSize * bytesPerPixel
  const maxCompressedTileBytes = deflateBound(maxUncompressedTileBytes)
  const estimatedTags = 15 + (description.channels === 4 ? 1 : 0) + (iccByteLength > 0 ? 1 : 0)
  const fixedDirectoryBytes = BIG_TIFF_HEADER_BYTES
    + BIG_TIFF_IFD_COUNT_BYTES
    + estimatedTags * BIG_TIFF_IFD_ENTRY_BYTES
    + BIG_TIFF_NEXT_IFD_BYTES
  const metadataUpperBoundBytes = align8(fixedDirectoryBytes)
    + tileCount * 16
    + iccByteLength
    + 16 * 1024
  return {
    tileSize,
    columns,
    rows,
    tileCount,
    bytesPerSample,
    bytesPerPixel,
    maxUncompressedTileBytes,
    maxCompressedTileBytes,
    maxWorkingSetBytes: maxUncompressedTileBytes + maxCompressedTileBytes + 512 * 1024,
    metadataUpperBoundBytes,
  }
}

function createDescriptionTag(description: BigTiffRasterDescription): Buffer {
  if (description.documentId.length > 4096 || (description.sourceFingerprint?.length ?? 0) > 4096) {
    throw new Error('BigTIFF document metadata exceeds the bounded limit')
  }
  return asciiValue(JSON.stringify({
    schema: 'henji-image-edit-v3-raster',
    colorSpace: description.colorSpace,
    transferFunction: description.transferFunction,
    byteOrder: description.byteOrder,
    alphaMode: description.channels === 4 ? description.alphaMode : undefined,
    documentId: description.documentId,
    revision: description.revision,
    sourceFingerprint: description.sourceFingerprint,
  }))
}

function createTags(
  description: BigTiffRasterDescription,
  plan: BigTiffPlan,
  iccProfile?: Uint8Array,
): TiffTag[] {
  const bits = Array.from({ length: description.channels }, () => description.bitDepth)
  const sampleFormat = description.sampleFormat === 'float' ? 3 : 1
  const imageDescription = createDescriptionTag(description)
  const tags: TiffTag[] = [
    { tag: 256, type: TiffType.Long, count: 1, value: longValue(description.width) },
    { tag: 257, type: TiffType.Long, count: 1, value: longValue(description.height) },
    { tag: 258, type: TiffType.Short, count: bits.length, value: shortValues(bits) },
    { tag: 259, type: TiffType.Short, count: 1, value: shortValues([8]) },
    { tag: 262, type: TiffType.Short, count: 1, value: shortValues([2]) },
    { tag: 270, type: TiffType.Ascii, count: imageDescription.byteLength, value: imageDescription },
    { tag: 274, type: TiffType.Short, count: 1, value: shortValues([1]) },
    { tag: 277, type: TiffType.Short, count: 1, value: shortValues([description.channels]) },
    { tag: 284, type: TiffType.Short, count: 1, value: shortValues([1]) },
    { tag: 305, type: TiffType.Ascii, count: 25, value: asciiValue('Henji-AI Image Editor V3') },
    { tag: 322, type: TiffType.Long, count: 1, value: longValue(plan.tileSize) },
    { tag: 323, type: TiffType.Long, count: 1, value: longValue(plan.tileSize) },
    {
      key: 'tileOffsets', tag: 324, type: TiffType.Long8,
      count: plan.tileCount, value: Buffer.alloc(plan.tileCount * 8),
    },
    {
      key: 'tileByteCounts', tag: 325, type: TiffType.Long8,
      count: plan.tileCount, value: Buffer.alloc(plan.tileCount * 8),
    },
    {
      tag: 339,
      type: TiffType.Short,
      count: description.channels,
      value: shortValues(Array.from({ length: description.channels }, () => sampleFormat)),
    },
  ]
  if (description.channels === 4) {
    tags.push({
      tag: 338,
      type: TiffType.Short,
      count: 1,
      value: shortValues([description.alphaMode === 'premultiplied' ? 1 : 2]),
    })
  }
  if (iccProfile) {
    tags.push({
      tag: 34675,
      type: TiffType.Undefined,
      count: iccProfile.byteLength,
      value: Buffer.from(iccProfile.buffer, iccProfile.byteOffset, iccProfile.byteLength),
    })
  }
  return tags.sort((left, right) => left.tag - right.tag)
}

export function buildBigTiffDirectory(
  description: BigTiffRasterDescription,
  tileSize: number,
  iccProfile?: Uint8Array,
): BigTiffDirectory {
  if (iccProfile) {
    const profile = Buffer.from(iccProfile.buffer, iccProfile.byteOffset, iccProfile.byteLength)
    if (
      profile.byteLength < 128
      || profile.byteLength > 16 * 1024 * 1024
      || profile.readUInt32BE(0) !== profile.byteLength
      || profile.toString('ascii', 16, 20) !== 'RGB '
      || profile.toString('ascii', 36, 40) !== 'acsp'
    ) {
      throw new Error('BigTIFF ICC profile header is invalid')
    }
  }
  const plan = planBigTiff(description, tileSize, iccProfile?.byteLength)
  const tags = createTags(description, plan, iccProfile)
  const ifdOffset = BIG_TIFF_HEADER_BYTES
  const ifdBytes = BIG_TIFF_IFD_COUNT_BYTES
    + tags.length * BIG_TIFF_IFD_ENTRY_BYTES
    + BIG_TIFF_NEXT_IFD_BYTES
  let auxiliaryOffset = align8(ifdOffset + ifdBytes)
  for (const tag of tags) {
    if (tag.value.byteLength > 8) auxiliaryOffset = align8(auxiliaryOffset + tag.value.byteLength)
  }
  const bytes = Buffer.alloc(auxiliaryOffset)
  bytes.write('II', 0, 'ascii')
  bytes.writeUInt16LE(43, 2)
  bytes.writeUInt16LE(8, 4)
  bytes.writeUInt16LE(0, 6)
  bytes.writeBigUInt64LE(BigInt(ifdOffset), 8)
  bytes.writeBigUInt64LE(BigInt(tags.length), ifdOffset)

  let nextAuxiliaryOffset = align8(ifdOffset + ifdBytes)
  let tileOffsetsPatchOffset = -1
  let tileByteCountsPatchOffset = -1
  tags.forEach((tag, index) => {
    const entryOffset = ifdOffset + BIG_TIFF_IFD_COUNT_BYTES + index * BIG_TIFF_IFD_ENTRY_BYTES
    bytes.writeUInt16LE(tag.tag, entryOffset)
    bytes.writeUInt16LE(tag.type, entryOffset + 2)
    bytes.writeBigUInt64LE(BigInt(tag.count), entryOffset + 4)
    const valueFieldOffset = entryOffset + 12
    let valueOffset = valueFieldOffset
    if (tag.value.byteLength <= 8) {
      tag.value.copy(bytes, valueFieldOffset)
    } else {
      valueOffset = nextAuxiliaryOffset
      bytes.writeBigUInt64LE(BigInt(valueOffset), valueFieldOffset)
      tag.value.copy(bytes, valueOffset)
      nextAuxiliaryOffset = align8(valueOffset + tag.value.byteLength)
    }
    if (tag.key === 'tileOffsets') tileOffsetsPatchOffset = valueOffset
    if (tag.key === 'tileByteCounts') tileByteCountsPatchOffset = valueOffset
  })
  if (tileOffsetsPatchOffset < 0 || tileByteCountsPatchOffset < 0) {
    throw new Error('BigTIFF tile directory is incomplete')
  }
  return {
    bytes,
    dataOffset: align8(bytes.byteLength),
    tileOffsetsPatchOffset,
    tileByteCountsPatchOffset,
    plan,
  }
}
