import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ContentAddressedResourceStore } from './resource-store'
import type { SourceExifOrientation } from './source-orientation'
import { SharpSourceProvider } from './source-provider'

let rootDir = ''
let store: ContentAddressedResourceStore

function createOrientationPixels(width: number, height: number): Buffer {
  const pixels = Buffer.allocUnsafe(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      pixels[offset] = (x * 17 + y * 3) % 256
      pixels[offset + 1] = (x * 5 + y * 29) % 256
      pixels[offset + 2] = (x * 11 + y * 7) % 256
    }
  }
  return pixels
}

function extractTightRgba(
  pixels: Buffer,
  sourceWidth: number,
  left: number,
  top: number,
  width: number,
  height: number,
): Buffer {
  const result = Buffer.allocUnsafe(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = ((top + row) * sourceWidth + left) * 4
    pixels.copy(result, row * width * 4, sourceOffset, sourceOffset + width * 4)
  }
  return result
}

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-v3-orientation-'))
  store = new ContentAddressedResourceStore(path.join(rootDir, 'resources'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

describe('SharpSourceProvider EXIF orientation', () => {
  it.each([2, 3, 4, 5, 6, 7, 8] as SourceExifOrientation[])(
    'EXIF %s 的 metadata、代理、金字塔、边缘与 halo 瓦片共享归一化方向',
    async (orientation) => {
      const encodedWidth = 520
      const encodedHeight = 516
      const encoded = await sharp(createOrientationPixels(encodedWidth, encodedHeight), {
        raw: { width: encodedWidth, height: encodedHeight, channels: 3 },
      }).withMetadata({ orientation }).tiff({ compression: 'none' }).toBuffer()
      const resource = await store.putBuffer(encoded, { mediaType: 'image/tiff' })
      const provider = new SharpSourceProvider(store)
      const swapsDimensions = orientation >= 5
      const width = swapsDimensions ? encodedHeight : encodedWidth
      const height = swapsDimensions ? encodedWidth : encodedHeight

      expect(await provider.readMetadata(resource.id)).toMatchObject({
        width,
        height,
        encodedWidth,
        encodedHeight,
        orientation,
        orientationApplied: true,
      })
      expect((await provider.describePyramid(resource.id)).levels[0]).toMatchObject({ width, height })
      expect(await provider.readFastProxy(resource.id, 512)).toMatchObject(
        swapsDimensions ? { width: 508, height: 512 } : { width: 512, height: 508 },
      )

      const reference = await sharp(encoded)
        .autoOrient()
        .toColourspace('srgb')
        .ensureAlpha()
        .raw({ depth: 'uchar' })
        .toBuffer({ resolveWithObject: true })
      expect(reference.info).toMatchObject({ width, height, channels: 4 })

      const edge = await provider.readTile({
        resourceId: resource.id,
        mip: 0,
        tileX: 1,
        tileY: 1,
      })
      expect(edge).toMatchObject({
        originX: 512,
        originY: 512,
        width: width - 512,
        height: height - 512,
        orientationApplied: true,
      })
      expect(edge.pixels.equals(extractTightRgba(
        reference.data,
        width,
        edge.originX,
        edge.originY,
        edge.width,
        edge.height,
      ))).toBe(true)

      const halo = await provider.readTile({
        resourceId: resource.id,
        mip: 0,
        tileX: 1,
        tileY: 1,
        halo: 3,
      })
      expect(halo).toMatchObject({
        originX: 509,
        originY: 509,
        width: width - 509,
        height: height - 509,
        orientationApplied: true,
      })
      expect(halo.pixels.equals(extractTightRgba(
        reference.data,
        width,
        halo.originX,
        halo.originY,
        halo.width,
        halo.height,
      ))).toBe(true)
    },
  )
})
