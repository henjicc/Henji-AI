import { exportImageEditSelectionMaskV3 } from '@/core/imageEdit/v3/selection/sessionRaster'
import { ImageEditSelectionRasterClientV3 } from '../execution/selectionRasterClientV3'
import type { ImageEditCommandBusV3 } from './imageEditCommandBus'

/** 1.7 的唯一交付入口：源尺寸灰度位图瓦片 + generator 最终返回实际 ROI；消费者逐块编码单通道 PNG。 */
export async function* exportCurrentImageEditSelectionV3(bus: ImageEditCommandBusV3, signal?: AbortSignal) {
  const snapshot = bus.getSnapshot()
  if (!snapshot.selection) throw new Error('请先创建选区')
  const client = new ImageEditSelectionRasterClientV3()
  try {
    const iterator = exportImageEditSelectionMaskV3(snapshot.selection, snapshot.document.geometry, async (selection, region) => {
      if (bus.getSnapshot().selectionRevision !== snapshot.selectionRevision || bus.getSnapshot().document.revision !== snapshot.document.revision) throw new Error('图片或选区已变化，请重新导出')
      const result = await client.rasterize({ selection, size: snapshot.document.geometry, region }, signal)
      if (bus.getSnapshot().selectionRevision !== snapshot.selectionRevision || bus.getSnapshot().document.revision !== snapshot.document.revision) throw new Error('图片或选区已变化，请重新导出')
      return result
    }, signal)
    while (true) {
      const result = await iterator.next()
      if (result.done) return result.value
      yield result.value
    }
  } finally { client.dispose() }
}
