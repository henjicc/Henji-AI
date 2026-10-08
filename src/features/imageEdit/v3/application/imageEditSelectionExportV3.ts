import { exportImageEditSelectionMaskV3 } from '@/core/imageEdit/v3/selection/sessionRaster'
import { ImageEditSelectionRasterClientV3 } from '../execution/selectionRasterClientV3'
import type { ImageEditCommandBusV3 } from './imageEditCommandBus'
import type { ImageEditSelectionSessionV3 } from '@/core/imageEdit/v3/selection/session'

/** 1.7 的唯一交付入口：源尺寸灰度位图瓦片 + generator 最终返回实际 ROI；消费者逐块编码单通道 PNG。 */
export async function* exportCurrentImageEditSelectionV3(bus: ImageEditCommandBusV3, signal?: AbortSignal, options?: {
  selection?: ImageEditSelectionSessionV3
  size?: { width: number; height: number }
  /** 导出像素坐标 → 未裁剪画面坐标；使变换图层与独立选区共用同一覆盖核。 */
  matrix?: readonly [number, number, number, number, number, number]
}) {
  const snapshot = bus.getSnapshot()
  const selection = options?.selection ?? snapshot.selection
  if (!selection) throw new Error('请先创建选区')
  const client = new ImageEditSelectionRasterClientV3()
  try {
    const iterator = exportImageEditSelectionMaskV3(selection, options?.size ?? snapshot.document.geometry, async (selection, region) => {
      if (bus.getSnapshot().selectionRevision !== snapshot.selectionRevision || bus.getSnapshot().document.revision !== snapshot.document.revision) throw new Error('图片或选区已变化，请重新导出')
      const result = await client.rasterize({ selection, size: snapshot.document.geometry, region, matrix: options?.matrix }, signal)
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
