import {
  createImageEditorV3RequestId,
  readImageEditorV3BrushTiles,
  readImageEditorV3SourceTile,
} from '@/commands/imageEditorV3'
import type {
  ImageEditBrushResourceReferenceV3,
  ImageEditBrushTargetV3,
  ImageEditBrushTileLoaderV3,
  ImageEditBrushTileV3,
} from '@/core/imageEdit/v3/brush/contracts'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts'
import { decodeInterleavedRgbaSourceTileV3 } from '@/core/imageEdit/v3/execution/sourceTileDecode'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRasterLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import { createTileRegion, type ImageEditTileCoordinate } from '@/core/imageEdit/v3/tileGeometry'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'

const TILE_SIZE = 512
const REFERENCE_WHITE_NITS = 203

type BrushTileReaderV3 = (
  tileKey: string,
  resource: ImageEditBrushResourceReferenceV3,
  signal: AbortSignal,
) => Promise<ImageEditBrushTileV3>

type SourceTileReaderV3 = (
  coordinate: ImageEditTileCoordinate,
  signal: AbortSignal,
) => Promise<ImageEditorV3SourceTile>

export interface ImageEditorRasterBrushTileLoaderOptionsV3 {
  document: ImageEditDocumentV3
  layer: ImageEditRasterLayerV3
  resourceByteSizes: ReadonlyMap<string, number>
  readBrushTile?: BrushTileReaderV3
  readSourceTile?: SourceTileReaderV3
}

function tileKey(coordinate: ImageEditTileCoordinate): string {
  return `${coordinate.mip}/${coordinate.x}/${coordinate.y}`
}

function sourceBitDepth(document: ImageEditDocumentV3): 8 | 16 | 32 {
  if (document.color.bitDepth === 'float16' || document.color.bitDepth === 'float32') return 32
  return document.color.bitDepth
}

function normalizeTileEncoding(
  tile: Extract<ImageEditBrushTileV3, { storage: 'rgba-float32' }>,
  target: Extract<ImageEditBrushTargetV3, { kind: 'raster-rgba' }>,
): ImageEditBrushTileV3 {
  return createFloat32PremultipliedRgbaTile(
    tile.width,
    tile.height,
    target.colorDomain,
    tile.data,
    target.workingSpace,
    target.transferFunction,
    target.referenceWhiteNits,
  )
}

export function createImageEditorRasterBrushTargetV3(
  document: ImageEditDocumentV3,
): Extract<ImageEditBrushTargetV3, { kind: 'raster-rgba' }> {
  return {
    kind: 'raster-rgba',
    colorDomain: 'linear-light',
    workingSpace: document.color.workingSpace,
    transferFunction: document.color.transferFunction,
    referenceWhiteNits: REFERENCE_WHITE_NITS,
    premultipliedColor: [0, 0, 0, 1],
  }
}

function defaultBrushTileReader(
  key: string,
  resource: ImageEditBrushResourceReferenceV3,
  signal: AbortSignal,
): Promise<ImageEditBrushTileV3> {
  return readImageEditorV3BrushTiles({
    requestId: createImageEditorV3RequestId('brush-tile-read'),
    tiles: [{ tileKey: key, resource }],
  }, signal).then((result) => {
    const loaded = result.tiles[0]
    if (!loaded || loaded.tileKey !== key) throw new Error(`画笔瓦片读取结果缺失：${key}`)
    return loaded.tile
  })
}

function createDefaultSourceTileReader(
  document: ImageEditDocumentV3,
  layer: ImageEditRasterLayerV3,
): SourceTileReaderV3 {
  return async (coordinate, signal) => {
    if (layer.source.kind !== 'resource') throw new Error('空栅格图层没有源瓦片')
    return readImageEditorV3SourceTile({
      requestId: createImageEditorV3RequestId('brush-source-tile-read'),
      resourceRef: layer.source.resourceId as `sha256:${string}`,
      mip: coordinate.mip,
      tileX: coordinate.x,
      tileY: coordinate.y,
      halo: 0,
      bitDepth: sourceBitDepth(document),
    }, signal)
  }
}

function validateSourceTile(
  tile: ImageEditorV3SourceTile,
  coordinate: ImageEditTileCoordinate,
  width: number,
  height: number,
): void {
  if (
    tile.mip !== coordinate.mip
    || tile.tileX !== coordinate.x
    || tile.tileY !== coordinate.y
    || tile.halo !== 0
    || tile.width !== width
    || tile.height !== height
    || tile.channels !== 4
    || tile.alphaMode !== 'straight'
  ) throw new Error(`图片源瓦片与画笔请求不匹配：${tileKey(coordinate)}`)
}

/** 稀疏覆盖优先；没有覆盖时从图层源读取，空图层则创建透明边缘瓦片。 */
export function createImageEditorRasterBrushTileLoaderV3(
  options: ImageEditorRasterBrushTileLoaderOptionsV3,
): ImageEditBrushTileLoaderV3 {
  const target = createImageEditorRasterBrushTargetV3(options.document)
  const readBrushTile = options.readBrushTile ?? defaultBrushTileReader
  const readSourceTile = options.readSourceTile
    ?? createDefaultSourceTileReader(options.document, options.layer)
  return async (coordinate, signal) => {
    const key = tileKey(coordinate)
    const region = createTileRegion(options.document.geometry, coordinate, 0, TILE_SIZE)
    const resourceId = options.layer.tiles[key]
    if (resourceId) {
      const byteSize = options.resourceByteSizes.get(resourceId)
      if (byteSize === undefined) {
        throw new Error(`可编辑文件缺少画笔瓦片大小，无法安全读取：${key}`)
      }
      const resource = { resourceId, byteSize }
      const tile = await readBrushTile(key, resource, signal)
      if (tile.storage !== 'rgba-float32') throw new Error(`栅格图层包含非 RGBA 画笔瓦片：${key}`)
      return { tile: normalizeTileEncoding(tile, target), resource }
    }
    if (options.layer.source.kind === 'empty') {
      return {
        tile: createFloat32PremultipliedRgbaTile(
          region.outputRect.width,
          region.outputRect.height,
          target.colorDomain,
          new Float32Array(region.outputRect.width * region.outputRect.height * 4),
          target.workingSpace,
          target.transferFunction,
          target.referenceWhiteNits,
        ),
        resource: null,
      }
    }
    const source = await readSourceTile(coordinate, signal)
    validateSourceTile(source, coordinate, region.outputRect.width, region.outputRect.height)
    const decoded = decodeInterleavedRgbaSourceTileV3({
      width: source.width,
      height: source.height,
      rowStride: source.rowStride,
      bitDepth: source.bitDepth,
      sampleFormat: source.sampleFormat,
      numericRange: source.numericRange,
      byteOrder: source.byteOrder,
      colorSpace: 'srgb',
      transferFunction: source.transferFunction,
      alphaMode: source.alphaMode,
      pixels: source.pixels,
    }, target.workingSpace)
    return { tile: normalizeTileEncoding(decoded, target), resource: null }
  }
}
