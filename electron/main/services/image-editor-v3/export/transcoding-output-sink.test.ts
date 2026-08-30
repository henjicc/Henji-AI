import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadSharp } from '../../image/sharp-loader'
import type { TileOutputDescription } from '../contracts'
import { ImageExportCapabilityError } from './capabilities'
import { TranscodingTileOutputSink } from './transcoding-output-sink'

const baseDescription: TileOutputDescription = {
  width: 16,
  height: 16,
  channels: 4,
  bitDepth: 8,
  sampleFormat: 'uint',
  colorSpace: 'srgb',
  transferFunction: 'srgb',
  alphaMode: 'straight',
  documentId: 'transcode-document',
  revision: 0,
  sourceFingerprint: 'sha256:transcode-source',
}

function tileFor(description: TileOutputDescription): Uint8Array {
  const bytesPerSample = description.bitDepth / 8
  const pixels = Buffer.alloc(description.width * description.height * 4 * bytesPerSample)
  if (description.bitDepth === 16) {
    for (let offset = 0; offset < pixels.byteLength; offset += 2) {
      pixels.writeUInt16LE((offset * 31) % 65_536, offset)
    }
  } else {
    for (let offset = 0; offset < pixels.byteLength; offset += 1) pixels[offset] = offset % 251
  }
  return pixels
}

let rootDir = ''

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-v3-transcode-'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

describe('TranscodingTileOutputSink', () => {
  it.each([
    { format: 'jpeg', extension: 'jpg', bitDepth: 8, sharpFormat: 'jpeg' },
    { format: 'webp', extension: 'webp', bitDepth: 8, sharpFormat: 'webp' },
    { format: 'png8', extension: 'png', bitDepth: 8, sharpFormat: 'png' },
    { format: 'png16', extension: 'png', bitDepth: 16, sharpFormat: 'png' },
    { format: 'tiff8', extension: 'tif', bitDepth: 8, sharpFormat: 'tiff' },
    { format: 'tiff16', extension: 'tif', bitDepth: 16, sharpFormat: 'tiff' },
    { format: 'avif10', extension: 'avif', bitDepth: 16, sharpFormat: 'heif' },
    { format: 'avif12', extension: 'avif', bitDepth: 16, sharpFormat: 'heif' },
  ] as const)(
    '通过有界 BigTIFF 中间文件输出 $format',
    async ({ format, extension, bitDepth, sharpFormat }) => {
      const targetPath = path.join(rootDir, `${format}.${extension}`)
      const description = { ...baseDescription, bitDepth }
      const sink = new TranscodingTileOutputSink(targetPath, {
        format,
        tileSize: 16,
        inputByteOrder: 'little-endian',
      })
      const pixels = tileFor(description)
      await sink.begin(description)
      await sink.writeTile({
        x: 0,
        y: 0,
        width: description.width,
        height: description.height,
        rowStride: description.width * 4 * (bitDepth / 8),
        pixels,
      })
      await sink.complete()

      const sharp = await loadSharp()
      const metadata = await sharp(targetPath).metadata()
      expect(metadata).toMatchObject({
        format: sharpFormat,
        width: description.width,
        height: description.height,
      })
      if (format === 'png16') expect(metadata.bitsPerSample).toBe(16)
      if (format === 'tiff16') expect(metadata.depth).toBe('ushort')
      if (format === 'avif10') expect(metadata.bitsPerSample).toBe(10)
      if (format === 'avif12') expect(metadata.bitsPerSample).toBe(12)
      expect(await fsp.readdir(rootDir)).toEqual([`${format}.${extension}`])
    },
    20_000,
  )

  it('取消时删除 staged 与 BigTIFF 中间文件并保留旧目标', async () => {
    const targetPath = path.join(rootDir, 'cancelled.png')
    await fsp.writeFile(targetPath, 'old')
    const description = { ...baseDescription, width: 32 }
    const sink = new TranscodingTileOutputSink(targetPath, {
      format: 'png8',
      tileSize: 16,
      inputByteOrder: 'little-endian',
    })
    await sink.begin(description)
    await sink.writeTile({
      x: 0, y: 0, width: 16, height: 16, rowStride: 64, pixels: new Uint8Array(1024),
    })
    await sink.cancel()

    expect(await fsp.readFile(targetPath, 'utf8')).toBe('old')
    expect(await fsp.readdir(rootDir)).toEqual(['cancelled.png'])
  })

  it('发布校验失败时清理转码结果与中间文件', async () => {
    const targetPath = path.join(rootDir, 'stale.png')
    await fsp.writeFile(targetPath, 'old')
    const sink = new TranscodingTileOutputSink(targetPath, {
      format: 'png8',
      tileSize: 16,
      inputByteOrder: 'little-endian',
      validateSnapshot: () => false,
    })
    await sink.begin(baseDescription)
    await sink.writeTile({
      x: 0, y: 0, width: 16, height: 16, rowStride: 64, pixels: new Uint8Array(1024),
    })
    await expect(sink.complete()).rejects.toThrow('no longer current')

    expect(await fsp.readFile(targetPath, 'utf8')).toBe('old')
    expect(await fsp.readdir(rootDir)).toEqual(['stale.png'])
  })

  it.each([
    {
      name: 'PQ/HDR',
      expectedCode: 'HDR_METADATA_UNSUPPORTED',
      description: {
        ...baseDescription,
        bitDepth: 16 as const,
        colorSpace: 'rec2020' as const,
        transferFunction: 'pq' as const,
        cicp: {
          colorPrimaries: 9,
          transferCharacteristics: 16,
          matrixCoefficients: 9,
          fullRange: false,
        },
      },
      format: 'avif10' as const,
    },
    {
      name: 'CICP',
      expectedCode: 'CICP_METADATA_UNSUPPORTED',
      description: {
        ...baseDescription,
        cicp: {
          colorPrimaries: 1,
          transferCharacteristics: 13,
          matrixCoefficients: 1,
          fullRange: true,
        },
      },
      format: 'png8' as const,
    },
    {
      name: 'linear transfer metadata',
      expectedCode: 'TRANSFER_FUNCTION_UNSUPPORTED',
      description: {
        ...baseDescription,
        transferFunction: 'linear' as const,
      },
      format: 'png8' as const,
    },
  ])('对无法可靠写入的 $name 返回明确能力错误', async ({ description, format, expectedCode }) => {
    const targetPath = path.join(rootDir, `${format}.output`)
    const sink = new TranscodingTileOutputSink(targetPath, {
      format,
      tileSize: 16,
      inputByteOrder: 'little-endian',
    })
    let failure: unknown
    try {
      await sink.begin(description)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ImageExportCapabilityError)
    expect(failure).toMatchObject({ code: expectedCode, format })
    await expect(fsp.access(targetPath)).rejects.toThrow()
    expect(await fsp.readdir(rootDir)).toEqual([])
  })

  it('拒绝与目标格式不匹配的渲染精度，避免静默量化', async () => {
    const targetPath = path.join(rootDir, 'wrong-depth.png')
    const sink = new TranscodingTileOutputSink(targetPath, {
      format: 'png8',
      tileSize: 16,
      inputByteOrder: 'little-endian',
    })
    await expect(sink.begin({ ...baseDescription, bitDepth: 16 })).rejects.toMatchObject({
      code: 'SOURCE_PRECISION_UNSUPPORTED',
    })
    expect(await fsp.readdir(rootDir)).toEqual([])
  })

  it('拒绝未显式声明为小端的输入瓦片', async () => {
    const targetPath = path.join(rootDir, 'wrong-endian.png')
    const sink = new TranscodingTileOutputSink(targetPath, {
      format: 'png8',
      tileSize: 16,
      inputByteOrder: 'big-endian' as 'little-endian',
    })
    await expect(sink.begin(baseDescription)).rejects.toMatchObject({
      code: 'BYTE_ORDER_UNSUPPORTED',
    })
    expect(await fsp.readdir(rootDir)).toEqual([])
  })
})
