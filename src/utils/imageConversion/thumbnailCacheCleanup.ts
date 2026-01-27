/**
 * 删除媒体文件对应的缩略图缓存
 */
export async function deleteThumbnailCache(mediaPath: string): Promise<boolean> {
  try {
    const { exists, remove } = await import('@tauri-apps/plugin-fs')
    const { getThumbnailsPath } = await import('@/utils/dataPath')
    const { join, basename } = await import('@tauri-apps/api/path')

    const thumbnailsDir = await getThumbnailsPath()
    const mediaName = await basename(mediaPath)
    const thumbName = mediaName.replace(/\.[^.]+$/, '.webp')
    const thumbPath = await join(thumbnailsDir, thumbName)

    const thumbExists = await exists(thumbPath)
    if (thumbExists) {
      await remove(thumbPath)
      console.log('[缩略图缓存] 已删除:', thumbPath)
      return true
    }
    return false
  } catch (error) {
    console.error('[缩略图缓存] 删除失败:', error)
    return false
  }
}

