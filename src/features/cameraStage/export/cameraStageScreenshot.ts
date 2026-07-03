import { persistImageSource, saveImageSourceToDownloads } from '@/commands/image'
import { createLogger } from '@/core/logging'
import { toDisplaySrc } from '@/platform/desktopApi'

/**
 * 摄像机截图导出：把 Canvas 读出的 PNG dataURL 落盘。
 * - 存进 Media 目录并返回 henji-media:// URL（供编辑器内预览"最近一次截图"）
 * - 另存到系统下载目录（用户可在生成/画布的图片输入位置直接选用，走通完整闭环）
 */

const logger = createLogger('cameraStage.screenshot')

export interface ScreenshotExportResult {
  /** henji-media:// 引用，供应用内预览 */
  mediaUrl: string
  /** 下载目录中的实际文件路径 */
  savedPath: string
}

function buildFileName(projectName: string): string {
  const stem = projectName.trim() || '运镜控制'
  const stamp = new Date()
    .toISOString()
    .replace(/[:T]/g, '-')
    .replace(/\..+$/, '')
  return `${stem}-${stamp}`
}

export async function exportSceneScreenshot(
  dataUrl: string,
  projectName: string,
): Promise<ScreenshotExportResult> {
  try {
    const persistedPath = await persistImageSource(dataUrl)
    const mediaUrl = toDisplaySrc(persistedPath)
    const savedPath = await saveImageSourceToDownloads(dataUrl, buildFileName(projectName))
    return { mediaUrl, savedPath }
  } catch (error) {
    logger.error('[cameraStage] 摄像机截图导出失败', error)
    throw error
  }
}
