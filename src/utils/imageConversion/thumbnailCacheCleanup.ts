import { createLogger } from '@/core/logging'
import { basename, exists, join } from '@/platform/desktopApi'
import { getPlatform } from '@/platform'

const logger = createLogger('utils.imageConversion.thumbnailCacheCleanup')

/**
 * 删除媒体文件对应的缩略图缓存
 */
export async function deleteThumbnailCache(mediaPath: string): Promise<boolean> {
  try {
    const { getThumbnailsPath } = await import('@/utils/dataPath')

    const thumbnailsDir = await getThumbnailsPath()
    const mediaName = basename(mediaPath)
    const thumbName = mediaName.replace(/\.[^.]+$/, '.webp')

    let deleted = false

    // Delete old 200px thumbnail
    const oldPath = await join(thumbnailsDir, thumbName)
    const oldExists = await exists(oldPath)
    if (oldExists) {
      await getPlatform().media.enqueueRecycle([oldPath], [mediaPath])
      logger.info('[缩略图缓存] 已提交回收:', oldPath)
      deleted = true
    }

    // Delete history 540px thumbnail
    const historyPath = await join(thumbnailsDir, '540', thumbName)
    const historyExists = await exists(historyPath)
    if (historyExists) {
      await getPlatform().media.enqueueRecycle([historyPath], [mediaPath])
      logger.info('[缩略图缓存] 已提交回收:', historyPath)
      deleted = true
    }

    return deleted
  } catch (error) {
    logger.error('[缩略图缓存] 删除失败:', error)
    return false
  }
}
