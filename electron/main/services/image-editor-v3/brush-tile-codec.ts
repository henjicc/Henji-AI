import crypto from 'node:crypto'
import os from 'node:os'
import { deflateRaw, inflateRaw } from 'node:zlib'

import {
  assertFloat32MaskTile,
  assertFloat32PremultipliedRgbaTile,
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
} from '../../../../src/core/imageEdit/v3/effects/contracts'
import type { ImageEditBrushTileV3 } from '../../../../src/core/imageEdit/v3/brush/contracts'

export const IMAGE_EDIT_BRUSH_TILE_CODEC_VERSION_V3 = 1
export const IMAGE_EDIT_BRUSH_TILE_MEDIA_TYPE_V3 = 'application/x-henji-brush-tile-v3'
export const IMAGE_EDIT_BRUSH_TILE_MAX_EDGE_V3 = 512
export const IMAGE_EDIT_BRUSH_TILE_MAX_RAW_BYTES_V3 = 512 * 512 * 4 * Float32Array.BYTES_PER_ELEMENT
export const IMAGE_EDIT_BRUSH_TILE_MAX_RESOURCE_BYTES_V3 = 5 * 1024 * 1024

const MAGIC = Buffer.from([0x48, 0x4a, 0x42, 0x54, 0x49, 0x4c, 0x45, 0x00]) // HJBTILE\0
const HEADER_BYTES = 80
const STORAGE_RGBA = 1
const STORAGE_MASK = 2
const COMPRESSION_DEFLATE_RAW = 1
const BYTE_ORDER_LITTLE_ENDIAN = 1
const SAMPLE_FORMAT_IEEE754_FLOAT32 = 1
const ALPHA_NONE = 0
const ALPHA_PREMULTIPLIED = 1

const COLOR_DOMAIN_TO_CODE = {
  'source-encoded': 1,
  'linear-light': 2,
  'perceptual-working': 3,
} as const
const CODE_TO_COLOR_DOMAIN = {
  1: 'source-encoded',
  2: 'linear-light',
  3: 'perceptual-working',
} as const
const WORKING_SPACE_TO_CODE = { srgb: 1, 'display-p3': 2, rec2020: 3 } as const
const CODE_TO_WORKING_SPACE = { 1: 'srgb', 2: 'display-p3', 3: 'rec2020' } as const
const TRANSFER_TO_CODE = { srgb: 1, linear: 2, pq: 3, hlg: 4 } as const
const CODE_TO_TRANSFER = { 1: 'srgb', 2: 'linear', 3: 'pq', 4: 'hlg' } as const

function abortError(): Error {
  const error = new Error('Image editor brush tile operation was cancelled')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function assertTileDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1
    || width > IMAGE_EDIT_BRUSH_TILE_MAX_EDGE_V3
    || height > IMAGE_EDIT_BRUSH_TILE_MAX_EDGE_V3) {
    throw new Error(`Brush tile dimensions must be within ${IMAGE_EDIT_BRUSH_TILE_MAX_EDGE_V3}×${IMAGE_EDIT_BRUSH_TILE_MAX_EDGE_V3}`)
  }
}

function assertRgbaValues(tile: Extract<ImageEditBrushTileV3, { storage: 'rgba-float32' }>): void {
  for (let offset = 0; offset < tile.data.length; offset += 4) {
    const alpha = tile.data[offset + 3]
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new Error('Brush RGBA tile alpha must contain finite values between 0 and 1')
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const value = tile.data[offset + channel]
      if (!Number.isFinite(value) || (alpha === 0 && value !== 0)) {
        throw new Error('Brush RGBA tile must contain finite premultiplied values')
      }
    }
  }
}

function float32ToLittleEndianBytes(values: Float32Array): Buffer {
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength)
  const output = Buffer.from(bytes)
  if (os.endianness() !== 'LE') output.swap32()
  return output
}

function littleEndianBytesToFloat32(bytes: Buffer): Float32Array {
  const copy = Uint8Array.from(bytes)
  if (os.endianness() === 'LE') return new Float32Array(copy.buffer)
  const view = new DataView(copy.buffer)
  const output = new Float32Array(copy.byteLength / Float32Array.BYTES_PER_ELEMENT)
  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true)
  }
  return output
}

function deflateBounded(bytes: Buffer, signal?: AbortSignal): Promise<Buffer> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    deflateRaw(bytes, { level: 6 }, (error, compressed) => {
      if (signal?.aborted) {
        reject(abortError())
        return
      }
      if (error) reject(error)
      else if (compressed.byteLength > IMAGE_EDIT_BRUSH_TILE_MAX_RESOURCE_BYTES_V3 - HEADER_BYTES) {
        reject(new Error('Compressed brush tile exceeds the resource byte limit'))
      } else resolve(compressed)
    })
  })
}

function inflateBounded(bytes: Buffer, expectedBytes: number, signal?: AbortSignal): Promise<Buffer> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    inflateRaw(bytes, { maxOutputLength: expectedBytes }, (error, raw) => {
      if (signal?.aborted) {
        reject(abortError())
        return
      }
      if (error) reject(new Error(`Invalid compressed brush tile: ${error.message}`, { cause: error }))
      else resolve(raw)
    })
  })
}

function readEnum<T extends string>(values: Readonly<Record<number, T>>, code: number, label: string): T {
  const value = values[code]
  if (!value) throw new Error(`Invalid brush tile ${label} code: ${code}`)
  return value
}

function assertReservedBytes(header: Buffer): void {
  if (header[25] !== 0) throw new Error('Unsupported brush tile flags')
  for (let offset = 70; offset < HEADER_BYTES; offset += 1) {
    if (header[offset] !== 0) throw new Error('Brush tile reserved header bytes must be zero')
  }
}

/** 编码为固定小端、带原始像素 SHA-256 的版本化权威瓦片资源。 */
export async function encodeImageEditBrushTileV3(
  tile: ImageEditBrushTileV3,
  signal?: AbortSignal,
): Promise<Buffer> {
  throwIfAborted(signal)
  assertTileDimensions(tile.width, tile.height)
  const rgba = tile.storage === 'rgba-float32'
  if (rgba) {
    assertFloat32PremultipliedRgbaTile(tile)
    assertRgbaValues(tile)
  } else {
    assertFloat32MaskTile(tile)
  }
  const raw = float32ToLittleEndianBytes(tile.data)
  if (raw.byteLength > IMAGE_EDIT_BRUSH_TILE_MAX_RAW_BYTES_V3) {
    throw new Error('Brush tile raw pixels exceed the byte limit')
  }
  const colorDomainCode = rgba ? COLOR_DOMAIN_TO_CODE[tile.colorDomain] : 0
  const workingSpaceCode = rgba ? WORKING_SPACE_TO_CODE[tile.workingSpace] : 0
  const transferCode = rgba ? TRANSFER_TO_CODE[tile.transferFunction] : 0
  if (rgba && (!colorDomainCode || !workingSpaceCode || !transferCode)) {
    throw new Error('Brush RGBA tile declares an unsupported color encoding')
  }
  const compressed = await deflateBounded(raw, signal)
  const header = Buffer.alloc(HEADER_BYTES)
  MAGIC.copy(header, 0)
  header.writeUInt16LE(IMAGE_EDIT_BRUSH_TILE_CODEC_VERSION_V3, 8)
  header.writeUInt16LE(HEADER_BYTES, 10)
  header[12] = rgba ? STORAGE_RGBA : STORAGE_MASK
  header[13] = COMPRESSION_DEFLATE_RAW
  header[14] = BYTE_ORDER_LITTLE_ENDIAN
  header[15] = SAMPLE_FORMAT_IEEE754_FLOAT32
  header.writeUInt16LE(tile.width, 16)
  header.writeUInt16LE(tile.height, 18)
  header[20] = rgba ? 4 : 1
  header[21] = rgba ? ALPHA_PREMULTIPLIED : ALPHA_NONE
  header[22] = colorDomainCode
  header[23] = workingSpaceCode
  header[24] = transferCode
  header.writeFloatLE(rgba ? tile.referenceWhiteNits : 0, 26)
  header.writeUInt32LE(raw.byteLength, 30)
  header.writeUInt32LE(compressed.byteLength, 34)
  crypto.createHash('sha256').update(raw).digest().copy(header, 38)
  const result = Buffer.concat([header, compressed])
  if (result.byteLength > IMAGE_EDIT_BRUSH_TILE_MAX_RESOURCE_BYTES_V3) {
    throw new Error('Brush tile resource exceeds the byte limit')
  }
  return result
}

/** 解码时先验证声明长度，再以声明的原始长度限制 inflate，防止压缩炸弹。 */
export async function decodeImageEditBrushTileV3(
  value: Uint8Array,
  signal?: AbortSignal,
): Promise<ImageEditBrushTileV3> {
  throwIfAborted(signal)
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (bytes.byteLength < HEADER_BYTES) throw new Error('Brush tile resource is truncated')
  if (bytes.byteLength > IMAGE_EDIT_BRUSH_TILE_MAX_RESOURCE_BYTES_V3) {
    throw new Error('Brush tile resource exceeds the byte limit')
  }
  if (!bytes.subarray(0, MAGIC.byteLength).equals(MAGIC)) throw new Error('Invalid brush tile magic')
  const version = bytes.readUInt16LE(8)
  if (version !== IMAGE_EDIT_BRUSH_TILE_CODEC_VERSION_V3) {
    throw new Error(`Unsupported brush tile codec version: ${version}`)
  }
  if (bytes.readUInt16LE(10) !== HEADER_BYTES) throw new Error('Invalid brush tile header length')
  if (bytes[13] !== COMPRESSION_DEFLATE_RAW
    || bytes[14] !== BYTE_ORDER_LITTLE_ENDIAN
    || bytes[15] !== SAMPLE_FORMAT_IEEE754_FLOAT32) {
    throw new Error('Unsupported brush tile binary encoding')
  }
  assertReservedBytes(bytes)
  const storage = bytes[12]
  if (storage !== STORAGE_RGBA && storage !== STORAGE_MASK) {
    throw new Error(`Unsupported brush tile storage code: ${storage}`)
  }
  const width = bytes.readUInt16LE(16)
  const height = bytes.readUInt16LE(18)
  assertTileDimensions(width, height)
  const rgba = storage === STORAGE_RGBA
  const channels = bytes[20]
  if (channels !== (rgba ? 4 : 1)) throw new Error('Brush tile channel count does not match storage')
  if (bytes[21] !== (rgba ? ALPHA_PREMULTIPLIED : ALPHA_NONE)) {
    throw new Error('Brush tile alpha contract does not match storage')
  }
  const expectedRawBytes = width * height * channels * Float32Array.BYTES_PER_ELEMENT
  const declaredRawBytes = bytes.readUInt32LE(30)
  if (declaredRawBytes !== expectedRawBytes
    || declaredRawBytes > IMAGE_EDIT_BRUSH_TILE_MAX_RAW_BYTES_V3) {
    throw new Error('Brush tile raw byte length does not match dimensions')
  }
  const compressedBytes = bytes.readUInt32LE(34)
  if (compressedBytes !== bytes.byteLength - HEADER_BYTES) {
    throw new Error('Brush tile compressed byte length does not match resource')
  }
  const raw = await inflateBounded(bytes.subarray(HEADER_BYTES), expectedRawBytes, signal)
  if (raw.byteLength !== expectedRawBytes) throw new Error('Brush tile decompressed length is invalid')
  const expectedHash = bytes.subarray(38, 70)
  const actualHash = crypto.createHash('sha256').update(raw).digest()
  if (!crypto.timingSafeEqual(expectedHash, actualHash)) throw new Error('Brush tile pixel hash mismatch')
  const data = littleEndianBytesToFloat32(raw)
  if (!rgba) {
    if (bytes[22] !== 0 || bytes[23] !== 0 || bytes[24] !== 0 || bytes.readFloatLE(26) !== 0) {
      throw new Error('Mask brush tile must not declare a color encoding')
    }
    return createFloat32MaskTile(width, height, data)
  }
  const colorDomain = readEnum(CODE_TO_COLOR_DOMAIN, bytes[22], 'color domain')
  const workingSpace = readEnum(CODE_TO_WORKING_SPACE, bytes[23], 'working space')
  const transferFunction = readEnum(CODE_TO_TRANSFER, bytes[24], 'transfer function')
  const referenceWhiteNits = bytes.readFloatLE(26)
  const tile = createFloat32PremultipliedRgbaTile(
    width,
    height,
    colorDomain,
    data,
    workingSpace,
    transferFunction,
    referenceWhiteNits,
  )
  assertRgbaValues(tile)
  return tile
}
