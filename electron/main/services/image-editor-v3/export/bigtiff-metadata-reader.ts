import type { FileHandle } from 'node:fs/promises'

const BIG_TIFF_HEADER_BYTES = 16
const BIG_TIFF_IFD_ENTRY_BYTES = 20
const MAX_IFD_ENTRIES = 128
const MAX_IMAGE_DESCRIPTION_BYTES = 64 * 1024
const IMAGE_DESCRIPTION_TAG = 270
const TIFF_ASCII_TYPE = 2

async function readExactly(
  handle: FileHandle,
  byteLength: number,
  position: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error('BigTIFF metadata range is invalid')
  }
  const bytes = Buffer.alloc(byteLength)
  let offset = 0
  while (offset < byteLength) {
    const result = await handle.read(bytes, offset, byteLength - offset, position + offset)
    if (result.bytesRead < 1) throw new Error('BigTIFF metadata ended unexpectedly')
    offset += result.bytesRead
  }
  return bytes
}

/** 只读取文件头、IFD 和有界 ImageDescription，不触碰任何像素瓦片。 */
export async function readBigTiffEmbeddedRasterMetadataV3(
  handle: FileHandle,
): Promise<unknown> {
  const fileSize = (await handle.stat()).size
  const header = await readExactly(handle, BIG_TIFF_HEADER_BYTES, 0)
  if (header.toString('ascii', 0, 2) !== 'II'
    || header.readUInt16LE(2) !== 43
    || header.readUInt16LE(4) !== 8
    || header.readUInt16LE(6) !== 0) {
    throw new Error('Encoded BigTIFF header is invalid')
  }
  const ifdOffset = Number(header.readBigUInt64LE(8))
  if (!Number.isSafeInteger(ifdOffset) || ifdOffset < BIG_TIFF_HEADER_BYTES || ifdOffset > fileSize - 8) {
    throw new Error('BigTIFF IFD offset is invalid')
  }
  const countBytes = await readExactly(handle, 8, ifdOffset)
  const entryCount = Number(countBytes.readBigUInt64LE(0))
  if (!Number.isSafeInteger(entryCount) || entryCount < 1 || entryCount > MAX_IFD_ENTRIES) {
    throw new Error('BigTIFF IFD entry count is invalid')
  }
  const entriesByteLength = entryCount * BIG_TIFF_IFD_ENTRY_BYTES
  if (ifdOffset + 8 + entriesByteLength > fileSize) {
    throw new Error('BigTIFF IFD exceeds the file bounds')
  }
  const entries = await readExactly(handle, entriesByteLength, ifdOffset + 8)
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = index * BIG_TIFF_IFD_ENTRY_BYTES
    if (entries.readUInt16LE(entryOffset) !== IMAGE_DESCRIPTION_TAG) continue
    if (entries.readUInt16LE(entryOffset + 2) !== TIFF_ASCII_TYPE) {
      throw new Error('BigTIFF ImageDescription must use TIFF ASCII')
    }
    const byteLength = Number(entries.readBigUInt64LE(entryOffset + 4))
    if (!Number.isSafeInteger(byteLength) || byteLength < 2 || byteLength > MAX_IMAGE_DESCRIPTION_BYTES) {
      throw new Error('BigTIFF ImageDescription size is invalid')
    }
    const valueField = entries.subarray(entryOffset + 12, entryOffset + 20)
    const data = byteLength <= 8
      ? valueField.subarray(0, byteLength)
      : await readDescriptionAtOffset(handle, valueField, byteLength, fileSize)
    if (data[data.byteLength - 1] !== 0) {
      throw new Error('BigTIFF ImageDescription is not null terminated')
    }
    try {
      return JSON.parse(data.toString('utf8', 0, data.byteLength - 1)) as unknown
    } catch (error) {
      throw new Error('BigTIFF ImageDescription JSON is invalid', { cause: error })
    }
  }
  throw new Error('BigTIFF ImageDescription is missing')
}

async function readDescriptionAtOffset(
  handle: FileHandle,
  valueField: Buffer,
  byteLength: number,
  fileSize: number,
): Promise<Buffer> {
  const offset = Number(valueField.readBigUInt64LE(0))
  if (!Number.isSafeInteger(offset) || offset < BIG_TIFF_HEADER_BYTES || offset > fileSize - byteLength) {
    throw new Error('BigTIFF ImageDescription offset is invalid')
  }
  return readExactly(handle, byteLength, offset)
}
