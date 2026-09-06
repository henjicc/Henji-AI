import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadSharp } from '../../image/sharp-loader'
import type { TileOutputDescription } from '../contracts'
import { TranscodingTileOutputSink } from './transcoding-output-sink'

const baseDescription: TileOutputDescription = {
  width: 1,
  height: 1,
  channels: 4,
  bitDepth: 8,
  sampleFormat: 'uint',
  colorSpace: 'srgb',
  transferFunction: 'srgb',
  alphaMode: 'straight',
  documentId: 'small-transcode-document',
  revision: 0,
  sourceFingerprint: 'sha256:small-transcode-source',
}

function createPixels(description: TileOutputDescription): Uint8Array {
  const pixels = new Uint8Array(description.width * description.height * 4)
  for (let offset = 0; offset < pixels.byteLength; offset += 4) {
    pixels[offset] = (offset * 3) % 251
    pixels[offset + 1] = (offset * 5 + 17) % 251
    pixels[offset + 2] = (offset * 7 + 31) % 251
    pixels[offset + 3] = 255
  }
  return pixels
}

let rootDir = ''

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-v3-small-transcode-'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

describe('TranscodingTileOutputSink 小尺寸文档', () => {
  it.each([
    ...[
      { format: 'png8' as const, extension: 'png', sharpFormat: 'png' as const },
      { format: 'tiff8' as const, extension: 'tif', sharpFormat: 'tiff' as const },
    ].flatMap((format) => [
      { ...format, width: 1, height: 1 },
      { ...format, width: 64, height: 64 },
      { ...format, width: 128, height: 1 },
    ]),
  ])('用默认 512 瓦片无损生成可读 $width×$height $format', async ({
    format,
    extension,
    sharpFormat,
    width,
    height,
  }) => {
    const targetPath = path.join(rootDir, `small-${width}x${height}.${extension}`)
    const description = { ...baseDescription, width, height }
    const pixels = createPixels(description)
    const sink = new TranscodingTileOutputSink(targetPath, {
      format,
      tileSize: 512,
      inputByteOrder: 'little-endian',
    })

    await sink.begin(description)
    await sink.writeTile({
      x: 0,
      y: 0,
      width: description.width,
      height: description.height,
      rowStride: description.width * 4,
      pixels,
    })
    await sink.complete()

    const sharp = await loadSharp()
    await expect(sharp(targetPath).metadata()).resolves.toMatchObject({
      format: sharpFormat,
      width: description.width,
      height: description.height,
    })
    const decoded = await sharp(targetPath).ensureAlpha().raw().toBuffer()
    expect(decoded).toEqual(Buffer.from(pixels))
  })
})
