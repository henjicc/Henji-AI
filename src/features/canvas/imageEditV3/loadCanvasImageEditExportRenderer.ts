import { createLogger } from '@/core/logging'
import { MultiLayerDocumentNodeApplicationError } from '../application/multiLayerDocumentNodeApplicationContracts'

const logger = createLogger('features.canvas.image-edit-export')

/** 装配和文档屏障保持常驻；仅执行导出时加载像素渲染器，由 import() 复用模块。 */
export async function loadCanvasImageEditExportRenderer(): Promise<typeof import('@/features/imageEdit/v3/export')> {
  try {
    return await import('@/features/imageEdit/v3/export')
  } catch (error) {
    logger.error('加载图片导出功能失败', error, { event: 'canvas.document.export.load.failed' })
    throw new MultiLayerDocumentNodeApplicationError(
      'OPERATION_FAILED', '图片导出功能加载失败，请重试；若仍失败，请重新打开应用', true, { cause: error },
    )
  }
}
