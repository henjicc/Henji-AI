import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadSharp } from '../../image/sharp-loader'
import { loadFfmpegPath } from '../../video/ffmpeg-loader'
import type { TileOutputDescription } from '../contracts'
import { readAssociatedNclxCicp } from '../isobmff-cicp'
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

function runFfmpegRaw(binary: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk) })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-64 * 1024) })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout))
      else reject(new Error(`ffmpeg decode failed with ${String(code)}\n${stderr}`))
    })
  })
}

function hdrTile(x: number, width: number, height: number): { pixels: Uint8Array; expected: Uint16Array } {
  const expected = new Uint16Array(width * height * 4)
  const samples = [
    [0, 0, 0, 65_535],
    [65_535, 0, 0, 32_768],
    [0, 65_535, 0, 16_384],
    [0, 0, 65_535, 8_192],
    [32_768, 16_384, 8_192, 4_096],
    [1_024, 2_048, 4_096, 0],
    [50_000, 40_000, 30_000, 12_345],
    [65_535, 65_535, 65_535, 60_000],
  ]
  for (let y = 0; y < height; y += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const sample = samples[(x + localX) % samples.length]
      const offset = (y * width + localX) * 4
      for (let channel = 0; channel < 4; channel += 1) expected[offset + channel] = sample[channel]
    }
  }
  return { pixels: new Uint8Array(expected.buffer), expected }
}

function pqDescription(width = 32, height = 16): TileOutputDescription {
  return {
    ...baseDescription,
    width,
    height,
    bitDepth: 16,
    colorSpace: 'rec2020',
    transferFunction: 'pq',
    cicp: { colorPrimaries: 9, transferCharacteristics: 16, matrixCoefficients: 9, fullRange: false },
    hdrMetadata: {},
  }
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
      if (format === 'tiff8' || format === 'tiff16') {
        const header = await fsp.readFile(targetPath)
        expect(header.toString('ascii', 0, 2)).toBe('II')
        expect(header.readUInt16LE(2)).toBe(42)
      }
      expect(await fsp.readdir(rootDir)).toEqual([`${format}.${extension}`])
    },
    20_000,
  )

  it.each([
    { format: 'avif10' as const, transferFunction: 'pq' as const, transferCode: 16, ffmpegTransfer: 'smpte2084', colorTolerance: 256, alphaTolerance: 128 },
    { format: 'avif12' as const, transferFunction: 'hlg' as const, transferCode: 18, ffmpegTransfer: 'arib-std-b67', colorTolerance: 64, alphaTolerance: 32 },
  ])(
    '$format 在编码前固定 Rec.2020 颜色变换，并保留高位深与 alpha',
    async ({ format, transferFunction, transferCode, ffmpegTransfer, colorTolerance, alphaTolerance }) => {
      const targetPath = path.join(rootDir, `${format}-${transferFunction}.avif`)
      const description: TileOutputDescription = {
        ...baseDescription,
        width: 32,
        bitDepth: 16,
        colorSpace: 'rec2020',
        transferFunction,
        cicp: {
          colorPrimaries: 9, transferCharacteristics: transferCode,
          matrixCoefficients: 9, fullRange: false,
        },
        hdrMetadata: {},
      }
      const sink = new TranscodingTileOutputSink(targetPath, {
        format,
        tileSize: 16,
        quality: 100,
        effort: 1,
        inputByteOrder: 'little-endian',
      })
      const expected = new Uint16Array(description.width * description.height * 4)
      await sink.begin(description)
      for (const x of [0, 16]) {
        const tile = hdrTile(x, 16, description.height)
        for (let row = 0; row < description.height; row += 1) {
          expected.set(
            tile.expected.subarray(row * 16 * 4, (row + 1) * 16 * 4),
            (row * description.width + x) * 4,
          )
        }
        await sink.writeTile({
          x,
          y: 0,
          width: 16,
          height: description.height,
          rowStride: 16 * 4 * 2,
          pixels: tile.pixels,
        })
      }
      await sink.complete()

      expect(await readAssociatedNclxCicp(targetPath, 'avif')).toEqual(description.cicp)
      const sharp = await loadSharp()
      expect(await sharp(targetPath).metadata()).toMatchObject({
        bitsPerSample: format === 'avif10' ? 10 : 12,
        hasAlpha: true,
      })

      const ffmpegPath = await loadFfmpegPath()
      const decodedColor = await runFfmpegRaw(ffmpegPath, [
        '-v', 'error',
        '-i', targetPath,
        '-map', '0:v:0',
        '-frames:v', '1',
        '-vf',
        `zscale=matrixin=2020_ncl:primariesin=2020:transferin=${ffmpegTransfer}:rangein=limited:`
          + `matrix=gbr:primaries=2020:transfer=${ffmpegTransfer}:range=full,format=gbrp16le`,
        '-f', 'rawvideo',
        'pipe:1',
      ])
      const planes = new Uint16Array(
        decodedColor.buffer, decodedColor.byteOffset, decodedColor.byteLength / 2,
      )
      const pixelCount = description.width * description.height
      expect(planes.length).toBe(pixelCount * 3)
      let maxColorError = 0
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const decodedRgb = [
          planes[pixel + pixelCount * 2],
          planes[pixel],
          planes[pixel + pixelCount],
        ]
        for (let channel = 0; channel < 3; channel += 1) {
          maxColorError = Math.max(
            maxColorError,
            Math.abs(decodedRgb[channel] - expected[pixel * 4 + channel]),
          )
        }
      }
      expect(maxColorError).toBeLessThanOrEqual(colorTolerance)

      const decodedRgba = await sharp(targetPath)
        .toColourspace('rgb16')
        .ensureAlpha()
        .raw({ depth: 'ushort' })
        .toBuffer()
      const rgba = new Uint16Array(
        decodedRgba.buffer,
        decodedRgba.byteOffset,
        decodedRgba.byteLength / 2,
      )
      let maxAlphaError = 0
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        maxAlphaError = Math.max(
          maxAlphaError,
          Math.abs(rgba[pixel * 4 + 3] - expected[pixel * 4 + 3]),
        )
      }
      expect(maxAlphaError).toBeLessThanOrEqual(alphaTolerance)
    },
    20_000,
  )

  it('HDR AVIF 取消会终止等待输入的编码器并清除 staged 文件', async () => {
    const targetPath = path.join(rootDir, 'cancelled-hdr.avif')
    await fsp.writeFile(targetPath, 'old')
    const description = pqDescription()
    const sink = new TranscodingTileOutputSink(targetPath, {
      format: 'avif10', tileSize: 16, inputByteOrder: 'little-endian',
    })
    await sink.begin(description)
    const tile = hdrTile(0, 16, description.height)
    await sink.writeTile({
      x: 0, y: 0, width: 16, height: description.height,
      rowStride: 16 * 8, pixels: tile.pixels,
    })
    await sink.cancel()

    expect(await fsp.readFile(targetPath, 'utf8')).toBe('old')
    expect(await fsp.readdir(rootDir)).toEqual(['cancelled-hdr.avif'])
  })

  it('HDR AVIF 不完整 tile band 会终止编码器且不发布半成品', async () => {
    const targetPath = path.join(rootDir, 'incomplete-hdr.avif')
    const description = pqDescription()
    const sink = new TranscodingTileOutputSink(targetPath, {
      format: 'avif10', tileSize: 16, inputByteOrder: 'little-endian',
    })
    await sink.begin(description)
    const tile = hdrTile(0, 16, description.height)
    await sink.writeTile({
      x: 0, y: 0, width: 16, height: description.height,
      rowStride: 16 * 8, pixels: tile.pixels,
    })
    await expect(sink.complete()).rejects.toThrow('incomplete')

    expect(await fsp.readdir(rootDir)).toEqual([])
  })

  it('HDR AVIF 快照失效会保留旧目标并清理已编码 staged 文件', async () => {
    const targetPath = path.join(rootDir, 'stale-hdr.avif')
    await fsp.writeFile(targetPath, 'old')
    const description = pqDescription(16, 16)
    const sink = new TranscodingTileOutputSink(targetPath, {
      format: 'avif10', tileSize: 16, quality: 100, effort: 1,
      inputByteOrder: 'little-endian', validateSnapshot: () => false,
    })
    const tile = hdrTile(0, description.width, description.height)
    await sink.begin(description)
    await sink.writeTile({
      x: 0, y: 0, width: description.width, height: description.height,
      rowStride: description.width * 8, pixels: tile.pixels,
    })
    await expect(sink.complete()).rejects.toThrow('no longer current')

    expect(await fsp.readFile(targetPath, 'utf8')).toBe('old')
    expect(await fsp.readdir(rootDir)).toEqual(['stale-hdr.avif'])
  })

  it('HDR AVIF 编码器在 begin 期间早退时不遗留子进程或 staged 文件', async () => {
    const targetPath = path.join(rootDir, 'early-exit.avif')
    const sink = new TranscodingTileOutputSink(targetPath, {
      format: 'avif10', tileSize: 16, inputByteOrder: 'little-endian',
    }, {
      // Node 不接受 FFmpeg 的 -y 参数，会在健康检查窗口内稳定早退。
      loadFfmpegPath: async () => process.execPath,
    })

    await expect(sink.begin(pqDescription(16, 16))).rejects.toThrow('HDR AVIF encoder failed')
    expect(await fsp.readdir(rootDir)).toEqual([])
  })

  it('JPEG 将透明像素显式合成到白底而不是依赖编码器默认值', async () => {
    const targetPath = path.join(rootDir, 'transparent.jpg')
    const sink = new TranscodingTileOutputSink(targetPath, {
      format: 'jpeg',
      quality: 100,
      tileSize: 16,
      inputByteOrder: 'little-endian',
    })
    const pixels = new Uint8Array(16 * 16 * 4)
    for (let offset = 0; offset < pixels.byteLength; offset += 4) {
      pixels[offset] = 255
      pixels[offset + 3] = 0
    }
    await sink.begin(baseDescription)
    await sink.writeTile({
      x: 0,
      y: 0,
      width: 16,
      height: 16,
      rowStride: 64,
      pixels,
    })
    await sink.complete()

    const sharp = await loadSharp()
    const decoded = await sharp(targetPath).removeAlpha().raw().toBuffer()
    expect(Math.min(...decoded)).toBeGreaterThanOrEqual(250)
  })

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

  it('HDR AVIF 在启动编码器前拒绝未实现的亮度元数据与无界 200MP 帧', async () => {
    const description: TileOutputDescription = {
      ...baseDescription,
      bitDepth: 16,
      colorSpace: 'rec2020',
      transferFunction: 'pq',
      cicp: { colorPrimaries: 9, transferCharacteristics: 16, matrixCoefficients: 9, fullRange: false },
    }
    const metadataSink = new TranscodingTileOutputSink(path.join(rootDir, 'metadata.avif'), {
      format: 'avif10',
      tileSize: 16,
      inputByteOrder: 'little-endian',
    })
    await expect(metadataSink.begin({
      ...description,
      hdrMetadata: { maxContentLightLevelNits: 1_000 },
    })).rejects.toMatchObject({ code: 'HDR_METADATA_UNSUPPORTED' })

    const largeSink = new TranscodingTileOutputSink(path.join(rootDir, 'large.avif'), {
      format: 'avif10',
      tileSize: 512,
      inputByteOrder: 'little-endian',
    })
    await expect(largeSink.begin({
      ...description,
      width: 20_000,
      height: 10_000,
    })).rejects.toMatchObject({ code: 'ENCODER_RESOURCE_LIMIT' })
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
