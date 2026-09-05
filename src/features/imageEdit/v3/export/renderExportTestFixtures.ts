import { createFloat32PremultipliedRgbaTile, type Float32PremultipliedRgbaTile, type ImageEditDocumentV3, type ImageEditJsonObjectV3 } from '@/core/imageEdit/v3'
import { createDefaultDiffusionOperationParams } from '@/core/imageEdit/diffusionParams'
import type { ImageEditorV3RasterExportDescription } from '@/platform/contracts/imageEditorV3'
import { type ImageEditorV3ExportAnnotationRasterizeRequest, type ImageEditorV3ExportSourceTileRequest, type ImageEditorV3ExportRenderDependencies } from './contracts'
import { renderImageEditorV3ExportTiles } from './renderExportTilesV3'
export const SOURCE = `sha256:${'1'.repeat(64)}` as const
export const MASK = `sha256:${'2'.repeat(64)}` as const
export const MASK_TILE = `sha256:${'3'.repeat(64)}` as const

export interface FakeImage {
  width: number
  height: number
  pixel(x: number, y: number): readonly [number, number, number, number]
}

export const description = (width: number, height: number): ImageEditorV3RasterExportDescription => ({
  width,
  height,
  bitDepth: 8,
  sampleFormat: 'uint',
  colorSpace: 'srgb',
  transferFunction: 'srgb',
  alphaMode: 'straight',
})

export function hdrDescription(
  width: number,
  height: number,
  transferFunction: 'pq' | 'hlg',
): ImageEditorV3RasterExportDescription {
  return {
    width,
    height,
    bitDepth: 16,
    sampleFormat: 'uint',
    colorSpace: 'rec2020',
    transferFunction,
    alphaMode: 'straight',
    iccProfileResourceRef: null,
    cicp: {
      colorPrimaries: 9,
      transferCharacteristics: transferFunction === 'pq' ? 16 : 18,
      matrixCoefficients: 9,
      fullRange: false,
    },
    hdrMetadata: null,
  }
}

export function hdrBigTiffDescription(
  width: number,
  height: number,
): ImageEditorV3RasterExportDescription {
  return {
    width,
    height,
    bitDepth: 32,
    sampleFormat: 'float',
    colorSpace: 'rec2020',
    transferFunction: 'linear',
    alphaMode: 'straight',
    iccProfileResourceRef: null,
    cicp: null,
    hdrMetadata: null,
  }
}

export function floatSourceReader(
  requests: ImageEditorV3ExportSourceTileRequest[],
  straightValue = 2,
) {
  return async (request: ImageEditorV3ExportSourceTileRequest) => {
    requests.push(request)
    const pixels = new Float32Array([straightValue, straightValue, straightValue, 0.5])
    return {
      resourceRef: request.resourceRef,
      mip: request.mip,
      tileX: request.tileX,
      tileY: request.tileY,
      halo: request.halo,
      width: 1,
      height: 1,
      channels: 4 as const,
      bitDepth: 32 as const,
      sampleFormat: 'float' as const,
      numericRange: 'scene-linear' as const,
      byteOrder: 'little-endian' as const,
      rowStride: 16,
      colorSpace: 'scrgb' as const,
      transferFunction: 'linear' as const,
      alphaMode: 'straight' as const,
      orientationApplied: true as const,
      originX: 0,
      originY: 0,
      pixels: pixels.buffer,
    }
  }
}

export function fakeSourceReader(images: ReadonlyMap<string, FakeImage>) {
  return async (request: ImageEditorV3ExportSourceTileRequest) => {
    const image = images.get(request.resourceRef)
    if (!image) throw new Error(`missing fake image ${request.resourceRef}`)
    const originX = request.tileX * 512
    const originY = request.tileY * 512
    const width = Math.min(512, image.width - originX)
    const height = Math.min(512, image.height - originY)
    const pixels = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        pixels.set(image.pixel(originX + x, originY + y), (y * width + x) * 4)
      }
    }
    return {
      resourceRef: request.resourceRef,
      mip: request.mip,
      tileX: request.tileX,
      tileY: request.tileY,
      halo: request.halo,
      width,
      height,
      channels: 4 as const,
      bitDepth: 8 as const,
      sampleFormat: 'uint' as const,
      numericRange: 'unorm8' as const,
      byteOrder: 'little-endian' as const,
      rowStride: width * 4,
      colorSpace: 'srgb' as const,
      transferFunction: 'srgb' as const,
      alphaMode: 'straight' as const,
      orientationApplied: true as const,
      originX,
      originY,
      pixels: pixels.buffer,
    }
  }
}

export function annotationImpulse(
  x: number,
  y: number,
): (request: ImageEditorV3ExportAnnotationRasterizeRequest) => Promise<Float32PremultipliedRgbaTile> {
  return async ({ document, region }) => {
    const data = new Float32Array(region.width * region.height * 4)
    if (x >= region.x && y >= region.y && x < region.x + region.width && y < region.y + region.height) {
      const offset = ((y - region.y) * region.width + x - region.x) * 4
      data.set([1, 1, 1, 1], offset)
    }
    return createFloat32PremultipliedRgbaTile(
      region.width,
      region.height,
      'linear-light',
      data,
      document.color.workingSpace,
      document.color.transferFunction,
      203,
    )
  }
}

export async function collectPixels(
  document: ImageEditDocumentV3,
  tileSize: number,
  images: ReadonlyMap<string, FakeImage>,
  rasterizeAnnotations?: ReturnType<typeof annotationImpulse>,
  managed?: {
    resourceDescriptors: Array<{
      resourceRef: `sha256:${string}`
      byteLength: number
      mediaType: string | null
    }>
    dependencies: Pick<ImageEditorV3ExportRenderDependencies, 'readBrushTiles'>
  },
): Promise<Uint8Array> {
  const width = document.geometry.crop?.width ?? (
    document.geometry.orientation.rotate === 90 || document.geometry.orientation.rotate === 270
      ? document.geometry.height
      : document.geometry.width
  )
  const height = document.geometry.crop?.height ?? (
    document.geometry.orientation.rotate === 90 || document.geometry.orientation.rotate === 270
      ? document.geometry.width
      : document.geometry.height
  )
  const output = new Uint8Array(width * height * 4)
  for await (const tile of renderImageEditorV3ExportTiles(
    {
      document,
      resourceDescriptors: managed?.resourceDescriptors ?? [],
      description: description(width, height),
      tileSize,
    },
    {
      readSourcePyramid: fakeSourcePyramidReader(images),
      readSourceTile: fakeSourceReader(images),
      rasterizeAnnotations,
      ...managed?.dependencies,
    },
  )) {
    const bytes = tile.pixels instanceof Uint8Array ? tile.pixels : new Uint8Array(tile.pixels)
    for (let row = 0; row < tile.height; row += 1) {
      const sourceStart = row * tile.rowStride
      const targetStart = ((tile.y + row) * width + tile.x) * 4
      output.set(bytes.subarray(sourceStart, sourceStart + tile.width * 4), targetStart)
    }
  }
  return output
}

export function solidImage(width: number, height: number, value = 0): FakeImage {
  return { width, height, pixel: () => [value, value, value, 255] }
}

export function impulseImage(width: number, height: number, x: number, y: number): FakeImage {
  return {
    width,
    height,
    pixel: (pixelX, pixelY) => pixelX === x && pixelY === y
      ? [255, 0, 0, 255]
      : [0, 0, 0, 0],
  }
}

export function diffusionParams(
  patch: Readonly<Record<string, unknown>> = {},
): ImageEditJsonObjectV3 {
  const defaults = createDefaultDiffusionOperationParams()
  return {
    ...defaults,
    tint: { ...defaults.tint },
    ...patch,
  } as unknown as ImageEditJsonObjectV3
}

export function fakeSourcePyramidReader(images: ReadonlyMap<string, Pick<FakeImage, 'width' | 'height'>>): NonNullable<ImageEditorV3ExportRenderDependencies['readSourcePyramid']> {
  return async (resourceRef) => {
    const image = images.get(resourceRef)
    if (!image) throw new Error('缺少测试源金字塔')
    return { tileSize: 512, levels: [{ mip: 0, width: image.width, height: image.height,
      columns: Math.ceil(image.width / 512), rows: Math.ceil(image.height / 512) }] }
  }
}
