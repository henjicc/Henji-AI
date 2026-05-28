import { getThumbnailsPath } from '@/utils/dataPath'
import { join, basename } from '@tauri-apps/api/path'

export async function getVideoThumbnailCachePath(videoPath: string): Promise<string> {
  const thumbnailsDir = await getThumbnailsPath()
  const videoName = await basename(videoPath)
  const thumbName = videoName.replace(/\.[^.]+$/, '.webp')
  return await join(thumbnailsDir, thumbName)
}

export async function getImageThumbnailCachePath(imagePath: string): Promise<string> {
  const thumbnailsDir = await getThumbnailsPath()
  const imageName = await basename(imagePath)
  const thumbName = imageName.replace(/\.[^.]+$/, '.webp')
  return await join(thumbnailsDir, thumbName)
}
