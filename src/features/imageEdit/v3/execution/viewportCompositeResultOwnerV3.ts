import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { imageEditOutputSizeV3 } from '@/core/imageEdit/v3/outputGeometry'
import type { ImageEditMemoryLease } from '@/core/imageEdit/v3/resourceBudget'
import { createTileRegion } from '@/core/imageEdit/v3/tileGeometry'
import type {
  ImageEditorViewportCompositeBitmapTileV3,
  ImageEditorViewportCompositeRenderedEventV3,
  ImageEditorViewportCompositeTileRenderedEventV3,
  ImageEditorViewportCompositeWorkerEventV3,
} from './viewportCompositeProtocolV3'
import type { ImageEditorViewportCompositeTileProgressV3 } from './viewportCompositeTypesV3'
import type { ImageEditorViewportTilePlanV3 } from './viewportTilePlannerV3'

interface ImageEditorViewportCompositeProgressOptionsV3 {
  document: ImageEditDocumentV3
  plan: ImageEditorViewportTilePlanV3
  renderGeneration: number
  cameraSequence: number
  geometryHash: string
  onTileReady?: (progress: ImageEditorViewportCompositeTileProgressV3) => void
}

function validateIdentity(
  event: ImageEditorViewportCompositeTileRenderedEventV3 | ImageEditorViewportCompositeRenderedEventV3,
  options: ImageEditorViewportCompositeProgressOptionsV3,
): void {
  if (
    event.revision !== options.document.revision
    || event.mip !== options.plan.mip
    || event.renderGeneration !== options.renderGeneration
    || event.cameraSequence !== options.cameraSequence
    || event.geometryHash !== options.geometryHash
  ) throw new Error('视口 Worker 返回了陈旧的像素代、相机或输出几何')
}

function validateBitmapTile(
  event: ImageEditorViewportCompositeTileRenderedEventV3,
  options: ImageEditorViewportCompositeProgressOptionsV3,
): void {
  if (!Number.isSafeInteger(event.tileIndex) || event.tileIndex < 0) {
    throw new Error('视口 Worker 返回了非法瓦片序号')
  }
  const request = options.plan.tiles[event.tileIndex]
  if (!request) throw new Error('视口 Worker 返回了额外成品瓦片')
  const expected = createTileRegion(
    imageEditOutputSizeV3(options.document.geometry),
    { mip: options.plan.mip, x: request.tileX, y: request.tileY },
    request.halo,
  ).outputRect
  const { tile } = event
  if (
    tile.outputRect.x !== expected.x
    || tile.outputRect.y !== expected.y
    || tile.outputRect.width !== expected.width
    || tile.outputRect.height !== expected.height
    || tile.bitmap.width !== tile.outputRect.width
    || tile.bitmap.height !== tile.outputRect.height
  ) throw new Error('视口 Worker 返回了错误尺寸的成品瓦片')
}

/** 接收逐瓦片 transferable，并在最终完成事件到达时一次性交接所有权。 */
export class ImageEditorViewportCompositeProgressV3 {
  private readonly tiles: Array<ImageEditorViewportCompositeBitmapTileV3 | undefined>
  private completedTiles = 0
  private transferred = false

  constructor(private readonly options: ImageEditorViewportCompositeProgressOptionsV3) {
    this.tiles = new Array(options.plan.tiles.length)
  }

  accept(event: ImageEditorViewportCompositeTileRenderedEventV3): void {
    let stored = false
    try {
      if (this.transferred) throw new Error('视口成品已完成，不能继续接收瓦片')
      validateIdentity(event, this.options)
      validateBitmapTile(event, this.options)
      if (this.tiles[event.tileIndex]) throw new Error('视口 Worker 返回了重复成品瓦片')
      this.tiles[event.tileIndex] = event.tile
      this.completedTiles += 1
      stored = true
      this.options.onTileReady?.({
        renderGeneration: event.renderGeneration,
        cameraSequence: event.cameraSequence,
        geometryHash: event.geometryHash,
        mip: event.mip,
        tileIndex: event.tileIndex,
        completedTiles: this.completedTiles,
        totalTiles: this.tiles.length,
        tile: event.tile,
      })
    } catch (error) {
      if (stored) {
        this.tiles[event.tileIndex] = undefined
        this.completedTiles -= 1
      }
      event.tile.bitmap.close()
      throw error
    }
  }

  complete(event: ImageEditorViewportCompositeRenderedEventV3): ImageEditorViewportCompositeBitmapTileV3[] {
    validateIdentity(event, this.options)
    const outputSize = imageEditOutputSizeV3(this.options.document.geometry)
    if (
      event.documentWidth !== outputSize.width
      || event.documentHeight !== outputSize.height
      || event.completedTiles !== this.tiles.length
      || this.completedTiles !== this.tiles.length
      || this.tiles.some((tile) => tile === undefined)
    ) throw new Error('视口 Worker 未完整返回计划中的成品瓦片')
    this.transferred = true
    return this.tiles as ImageEditorViewportCompositeBitmapTileV3[]
  }

  release(): void {
    if (this.transferred) return
    this.transferred = true
    for (const tile of this.tiles) tile?.bitmap.close()
  }
}

export class ImageEditorViewportCompositeResultOwnerV3 {
  private readonly releases = new Set<() => void>()

  lease(tiles: ImageEditorViewportCompositeBitmapTileV3[], gpuLease: ImageEditMemoryLease): () => void {
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.releases.delete(release)
      for (const tile of tiles) tile.bitmap.close()
      gpuLease.release()
    }
    this.releases.add(release)
    return release
  }

  releaseEvent(event: ImageEditorViewportCompositeWorkerEventV3): void {
    if (event.type === 'tile-rendered') event.tile.bitmap.close()
  }

  dispose(): void {
    for (const release of [...this.releases]) release()
  }
}
