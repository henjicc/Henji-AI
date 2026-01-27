export async function getVideoThumbnailCachePath(videoPath: string): Promise<string> {
  const { getThumbnailsPath } = await import('@/utils/dataPath')
  const { join, basename } = await import('@tauri-apps/api/path')

  const thumbnailsDir = await getThumbnailsPath()
  const videoName = await basename(videoPath)
  const thumbName = videoName.replace(/\.[^.]+$/, '.webp')
  return await join(thumbnailsDir, thumbName)
}

export async function getImageThumbnailCachePath(imagePath: string): Promise<string> {
  const { getThumbnailsPath } = await import('@/utils/dataPath')
  const { join, basename } = await import('@tauri-apps/api/path')

  const thumbnailsDir = await getThumbnailsPath()
  const imageName = await basename(imagePath)
  const thumbName = imageName.replace(/\.[^.]+$/, '.webp')
  return await join(thumbnailsDir, thumbName)
}

