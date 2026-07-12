import {
  copyImageSourceToClipboard,
  persistImageSource,
  saveImageSourceToDirectory,
  saveImageSourceToPath,
} from '@/commands/image'
import { createLogger } from '@/core/logging'
import { QUICK_DOWNLOAD_SETTING_SPECS, readLocalStorageSettings } from '@/hooks/useLocalStorageSetting'
import { saveDialog, toDisplaySrc } from '@/platform/desktopApi'

/**
 * 摄像机截图导出：把 Canvas 读出的 PNG dataURL 落盘。
 * - 存进 Media 目录并返回 henji-media:// URL（供编辑器内预览"最近一次截图"）
 * - 本地保存遵循快速保存设置；未开启时弹出系统保存对话框
 */

const logger = createLogger('cameraStage.screenshot')

export interface ScreenshotExportResult {
  /** henji-media:// 引用，供应用内预览 */
  mediaUrl: string
  /** 本地实际文件路径 */
  savedPath: string
  /** 保存路径来源 */
  saveMode: 'quick' | 'dialog'
}

export interface CameraStageFrameResult {
  mediaUrl: string
}

/** 仅持久化为应用媒体，供画布节点消费；不会触发系统保存对话框。 */
export async function persistSceneScreenshot(dataUrl: string): Promise<CameraStageFrameResult> {
  const persistedPath = await persistImageSource(dataUrl)
  return { mediaUrl: toDisplaySrc(persistedPath) }
}

function buildFileName(projectName: string): string {
  const stem = projectName.trim() || '3D 镜头参考'
  const stamp = new Date()
    .toISOString()
    .replace(/[:T]/g, '-')
    .replace(/\..+$/, '')
  return `${stem}-${stamp}`
}

function ensurePngPath(targetPath: string): string {
  if (/\.png$/i.test(targetPath)) return targetPath
  if (/\.[^\\/]+$/.test(targetPath)) {
    return targetPath.replace(/\.[^\\/]+$/, '.png')
  }
  return `${targetPath}.png`
}

async function saveScreenshotToLocal(dataUrl: string, fileNameStem: string): Promise<{
  savedPath: string
  saveMode: ScreenshotExportResult['saveMode']
} | null> {
  const { enableQuickDownload, quickDownloadPath } = readLocalStorageSettings(QUICK_DOWNLOAD_SETTING_SPECS)
  const targetDir = quickDownloadPath.trim()

  if (enableQuickDownload && targetDir) {
    const savedPath = await saveImageSourceToDirectory(dataUrl, targetDir, fileNameStem)
    return { savedPath, saveMode: 'quick' }
  }

  const targetPath = await saveDialog({
    defaultPath: `${fileNameStem}.png`,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  })
  if (!targetPath) return null

  const savedPath = await saveImageSourceToPath(dataUrl, ensurePngPath(targetPath))
  return { savedPath, saveMode: 'dialog' }
}

export async function exportSceneScreenshot(
  dataUrl: string,
  projectName: string,
): Promise<ScreenshotExportResult | null> {
  try {
    const fileNameStem = buildFileName(projectName)
    const localResult = await saveScreenshotToLocal(dataUrl, fileNameStem)
    if (!localResult) return null
    return { ...(await persistSceneScreenshot(dataUrl)), ...localResult }
  } catch (error) {
    logger.error('[cameraStage] 摄像机截图导出失败', error)
    throw error
  }
}

export async function copySceneScreenshotToClipboard(dataUrl: string): Promise<void> {
  try {
    await copyImageSourceToClipboard(dataUrl)
  } catch (error) {
    logger.error('[cameraStage] 摄像机截图复制失败', error)
    throw error
  }
}
