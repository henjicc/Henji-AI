import { getThumbnailsPath } from '@/utils/dataPath'
import { basename, join } from '@/platform/desktopApi'

export async function getVideoThumbnailCachePath(videoPath: string): Promise<string> {
  const thumbnailsDir = await getThumbnailsPath()
  const videoName = basename(videoPath)
  const thumbName = videoName.replace(/\.[^.]+$/, '.webp')
  return await join(thumbnailsDir, thumbName)
}

export async function getImageThumbnailCachePath(imagePath: string): Promise<string> {
  const thumbnailsDir = await getThumbnailsPath()
  const imageName = basename(imagePath)
  const thumbName = imageName.replace(/\.[^.]+$/, '.webp')
  return await join(thumbnailsDir, thumbName)
}
