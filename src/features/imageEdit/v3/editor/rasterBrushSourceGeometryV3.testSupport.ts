import { vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditBrushTileChangeV3 } from '@/core/imageEdit/v3/brush/contracts'
import type { ImageEditorV3PyramidDescriptor } from '@/platform/contracts/imageEditorV3'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { createImageEditorRasterBrushTileLoaderV3, createImageEditorRasterBrushTargetV3 } from './rasterBrushTilesV3'
import { ImageEditorRasterBrushStrokeV3 } from './rasterBrushStrokeV3'

export const SOURCE = `sha256:${'a'.repeat(64)}` as const
export const BRUSH = `sha256:${'b'.repeat(64)}` as const
export function createRasterSourceBrushFixtureV3(sourceSize: number, canvasSize: number, scale = canvasSize / sourceSize) {
  const document = createImageEditDocumentV3({ width: canvasSize, height: canvasSize, sourceResourceId: SOURCE })
  const layer = document.layers[0]
  if (layer.type !== 'raster') throw new Error('fixture expected raster')
  layer.transform = [scale, 0, 0, scale, 0, 0]
  const pyramid: ImageEditorV3PyramidDescriptor = { tileSize: 512, levels: Array.from({ length: Math.ceil(Math.log2(sourceSize)) + 1 }, (_, mip) => {
    const width = Math.ceil(sourceSize / (2 ** mip))
    return { mip, width, height: width, columns: Math.ceil(width / 512), rows: Math.ceil(width / 512) }
  }) }
  const readSourcePyramid = vi.fn(async () => pyramid)
  const readSourceTile = vi.fn(async (coordinate: { x: number; y: number; mip: number }) => {
    const originX = coordinate.x * 512, originY = coordinate.y * 512
    const size = Math.ceil(sourceSize / (2 ** coordinate.mip))
    const width = Math.min(512, size - originX), height = Math.min(512, size - originY)
    if (width <= 0 || height <= 0) throw new Error('不得请求不存在的原图瓦片')
    const pixels = new Uint8Array(width * height * 4)
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255
    return { resourceRef: SOURCE, mip: coordinate.mip, tileX: coordinate.x, tileY: coordinate.y,
      halo: 0, width, height, originX, originY, rowStride: width * 4, pixels: pixels.buffer,
      channels: 4 as const, bitDepth: 8 as const, sampleFormat: 'uint' as const, numericRange: 'unorm8' as const,
      byteOrder: 'little-endian' as const, colorSpace: 'srgb' as const, transferFunction: 'srgb' as const,
      alphaMode: 'straight' as const, orientationApplied: true as const }
  })
  const resourceByteSizes = new Map<string, number>()
  const loader = createImageEditorRasterBrushTileLoaderV3({ document, layer, resourceByteSizes, readSourceTile, readSourcePyramid })
  const bus = new ImageEditCommandBusV3(document)
  const stored = new Map<string, ImageEditBrushTileChangeV3['tile']>()
  const persistTiles = vi.fn(async (tiles: ReadonlyArray<Pick<ImageEditBrushTileChangeV3, 'tileKey' | 'tile'>>) => tiles.map((tile) => {
    stored.set(tile.tileKey, tile.tile)
    return { tileKey: tile.tileKey, resourceId: BRUSH, byteSize: tile.tile.data.byteLength }
  }))
  const stroke = new ImageEditorRasterBrushStrokeV3({ document, bus, layerId: layer.id, tool: 'brush',
    shape: { size: 4, hardness: 1, opacity: 1 }, target: { ...createImageEditorRasterBrushTargetV3(document), premultipliedColor: [1, 1, 1, 1] },
    loadTile: loader, resolveStorageSize: loader.resolveStorageSize, resourceByteSizes, onPreviewTiles: vi.fn(), persistTiles })
  return { document, bus, layer, loader, stroke, readSourcePyramid, readSourceTile, pyramid, stored, persistTiles }
}
