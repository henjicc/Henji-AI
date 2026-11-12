import { getThumbnailsPath } from '@/utils/dataPath'
import { join } from '@/platform/desktopApi'
import { thumbnailCacheFileName } from '@/core/media/thumbnailCacheName'

export async function getVideoThumbnailCachePath(videoPath: string): Promise<string> {
  return await join(await getThumbnailsPath(), thumbnailCacheFileName(videoPath))
}

export async function getImageThumbnailCachePath(imagePath: string): Promise<string> {
  return await join(await getThumbnailsPath(), thumbnailCacheFileName(imagePath))
}
