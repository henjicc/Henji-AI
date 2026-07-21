import { createLogger } from '@/core/logging'
import { basename, dirname, exists, join, mkdir, toDisplaySrc, writeFile } from '@/platform/desktopApi'

const logger = createLogger('utils.historyThumbnail')

/**
 * Get the cache path for a history thumbnail (540px max, stored in /540/ subdirectory)
 */
export async function getHistoryThumbnailCachePath(imagePath: string): Promise<string> {
  const { getThumbnailsPath } = await import('@/utils/dataPath')
  const thumbnailsDir = await getThumbnailsPath()
  const imageName = basename(imagePath)
  const thumbName = imageName.replace(/\.[^.]+$/, '.webp')
  return await join(thumbnailsDir, '540', thumbName)
}

/**
 * Get or create a 540px WebP history thumbnail.
 * Returns the thumbnail cache path (not data URL), suitable for toDisplaySrc.
 * Falls back to generating on first call, then serves from cache.
 */
export async function getOrCreateHistoryThumbnail(
  imagePath: string,
  imageUrl?: string
): Promise<string | undefined> {
  try {
    const cachePath = await getHistoryThumbnailCachePath(imagePath)
    const cacheExists = await exists(cachePath)

    if (cacheExists) {
      return cachePath
    }

    // Generate thumbnail: 540px max, WebP quality 0.8
    const url = imageUrl || toDisplaySrc(imagePath.replace(/\\/g, '/'))

    // Ensure parent directory exists
    const parentDir = await dirname(cachePath)
    const parentExists = await exists(parentDir)
    if (!parentExists) {
      await mkdir(parentDir, { recursive: true })
    }

    await new Promise<void>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      const timeout = setTimeout(() => reject(new Error('History thumbnail generation timeout')), 15000)

      img.onload = async () => {
        try {
          clearTimeout(timeout)

          let width = img.naturalWidth
          let height = img.naturalHeight
          if (width === 0 || height === 0) {
            reject(new Error('Image dimensions are zero'))
            return
          }

          const MAX_SIZE = 540
          if (width > height) {
            if (width > MAX_SIZE) {
              height = height * (MAX_SIZE / width)
              width = MAX_SIZE
            }
          } else {
            if (height > MAX_SIZE) {
              width = width * (MAX_SIZE / height)
              height = MAX_SIZE
            }
          }

          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(width)
          canvas.height = Math.floor(height)
          const ctx = canvas.getContext('2d')
          if (!ctx) { reject(new Error('Failed to get canvas context')); return }

          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

          const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', 0.8))
          if (!blob) { reject(new Error('Failed to create blob')); return }

          const buffer = await blob.arrayBuffer()
          await writeFile(cachePath, new Uint8Array(buffer))
          resolve()
        } catch (err) {
          clearTimeout(timeout)
          reject(err)
        }
      }

      img.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('Failed to load image for history thumbnail'))
      }

      img.src = url
    })

    return cachePath
  } catch (error) {
    logger.error('[HistoryThumbnail] Generation failed:', error)
    return undefined
  }
}
