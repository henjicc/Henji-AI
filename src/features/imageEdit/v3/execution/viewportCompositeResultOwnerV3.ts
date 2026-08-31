import type { ImageEditMemoryLease } from '@/core/imageEdit/v3/resourceBudget'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { createTileRegion } from '@/core/imageEdit/v3/tileGeometry'
import type { ImageEditorViewportCompositeWorkerEventV3 } from './viewportCompositeProtocolV3'
import type { ImageEditorViewportTilePlanV3 } from './viewportTilePlannerV3'

type RenderedViewportEventV3 = Extract<
  ImageEditorViewportCompositeWorkerEventV3,
  { type: 'rendered' }
>

export function validateImageEditorViewportCompositeEventV3(
  event: RenderedViewportEventV3,
  document: ImageEditDocumentV3,
  plan: ImageEditorViewportTilePlanV3,
): void {
  if (
    event.revision !== document.revision
    || event.documentWidth !== document.geometry.width
    || event.documentHeight !== document.geometry.height
    || event.mip !== plan.mip
    || event.tiles.length !== plan.tiles.length
  ) throw new Error('视口 Worker 返回了陈旧或无效成品帧')
  for (const [index, tile] of event.tiles.entries()) {
    const request = plan.tiles[index]
    if (!request) throw new Error('视口 Worker 返回了额外成品瓦片')
    const expected = createTileRegion(
      document.geometry,
      { mip: plan.mip, x: request.tileX, y: request.tileY },
      request.halo,
    ).outputRect
    if (
      tile.outputRect.x !== expected.x
      || tile.outputRect.y !== expected.y
      || tile.outputRect.width !== expected.width
      || tile.outputRect.height !== expected.height
      || tile.bitmap.width !== tile.outputRect.width
      || tile.bitmap.height !== tile.outputRect.height
    ) throw new Error('视口 Worker 返回了错误尺寸的成品瓦片')
  }
}

export class ImageEditorViewportCompositeResultOwnerV3 {
  private readonly releases = new Set<() => void>()

  lease(event: RenderedViewportEventV3, gpuLease: ImageEditMemoryLease): () => void {
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.releases.delete(release)
      for (const tile of event.tiles) tile.bitmap.close()
      gpuLease.release()
    }
    this.releases.add(release)
    return release
  }

  releaseEvent(event: ImageEditorViewportCompositeWorkerEventV3): void {
    if (event.type === 'rendered') for (const tile of event.tiles) tile.bitmap.close()
  }

  dispose(): void {
    for (const release of [...this.releases]) release()
  }
}
