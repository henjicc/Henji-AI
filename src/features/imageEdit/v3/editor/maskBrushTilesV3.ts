import {
  createImageEditorV3RequestId,
  readImageEditorV3BrushTiles,
} from '@/commands/imageEditorV3'
import type {
  ImageEditBrushResourceReferenceV3,
  ImageEditBrushTargetV3,
  ImageEditBrushTileLoaderV3,
  ImageEditBrushTileV3,
} from '@/core/imageEdit/v3/brush/contracts'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { createFloat32MaskTile } from '@/core/imageEdit/v3/effects/contracts'
import type { ImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import { createTileRegion, type ImageEditTileCoordinate } from '@/core/imageEdit/v3/tileGeometry'

type MaskTileReaderV3 = (
  tileKey: string,
  resource: ImageEditBrushResourceReferenceV3,
  signal: AbortSignal,
) => Promise<ImageEditBrushTileV3>

export interface ImageEditorMaskBrushTileLoaderOptionsV3 {
  document: ImageEditDocumentV3
  mask: ImageEditSparseMaskReferenceV3
  resourceByteSizes: ReadonlyMap<string, number>
  readBrushTile?: MaskTileReaderV3
}

function tileKey(coordinate: ImageEditTileCoordinate): string {
  return `${coordinate.mip}/${coordinate.x}/${coordinate.y}`
}

function defaultMaskTileReader(
  key: string,
  resource: ImageEditBrushResourceReferenceV3,
  signal: AbortSignal,
): Promise<ImageEditBrushTileV3> {
  return readImageEditorV3BrushTiles({
    requestId: createImageEditorV3RequestId('mask-brush-tile-read'),
    tiles: [{ tileKey: key, resource }],
  }, signal).then((result) => {
    const loaded = result.tiles[0]
    if (!loaded || loaded.tileKey !== key) throw new Error(`蒙版瓦片读取结果缺失：${key}`)
    return loaded.tile
  })
}

export function createImageEditorMaskBrushTargetV3(): Extract<
  ImageEditBrushTargetV3,
  { kind: 'mask' }
> {
  return { kind: 'mask', brushValue: 1 }
}

/** 缺失瓦片按蒙版声明的默认值惰性创建，不分配全画布表面。 */
export function createImageEditorMaskBrushTileLoaderV3(
  options: ImageEditorMaskBrushTileLoaderOptionsV3,
): ImageEditBrushTileLoaderV3 {
  const readBrushTile = options.readBrushTile ?? defaultMaskTileReader
  return async (coordinate, signal) => {
    if (coordinate.mip !== 0) throw new Error('首版蒙版画笔只允许编辑 mip 0 权威瓦片')
    const key = tileKey(coordinate)
    const region = createTileRegion(options.document.geometry, coordinate, 0, options.mask.tileSize)
    const resourceId = options.mask.tiles[key]
    if (!resourceId) {
      const data = new Float32Array(region.outputRect.width * region.outputRect.height)
      if (options.mask.defaultValue === 1) data.fill(1)
      return {
        tile: createFloat32MaskTile(region.outputRect.width, region.outputRect.height, data),
        resource: null,
      }
    }
    const byteSize = options.resourceByteSizes.get(resourceId)
    if (byteSize === undefined) {
      throw new Error(`可编辑文件缺少蒙版瓦片大小，无法安全读取：${key}`)
    }
    const resource = { resourceId, byteSize }
    const tile = await readBrushTile(key, resource, signal)
    if (tile.storage !== 'mask-float32'
      || tile.width !== region.outputRect.width
      || tile.height !== region.outputRect.height) {
      throw new Error(`蒙版图层包含不匹配的 Float32 瓦片：${key}`)
    }
    return { tile, resource }
  }
}
