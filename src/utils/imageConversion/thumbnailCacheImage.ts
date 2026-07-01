import { exists, mkdir, toDisplaySrc, writeFile } from '@/platform/desktopApi'
import { getImageThumbnailCachePath } from './thumbnailCachePaths'

export interface CachedThumbnailResult {
  filePath: string
  displaySrc: string
  dataUrl?: string
}

export async function generateAndCacheImageThumbnail(imagePath: string, imageUrl: string): Promise<string> {
  const { getThumbnailsPath } = await import('@/utils/dataPath')

  const cachePath = await getImageThumbnailCachePath(imagePath)

  const thumbnailsDir = await getThumbnailsPath()
  const dirExists = await exists(thumbnailsDir)
  if (!dirExists) {
    await mkdir(thumbnailsDir, { recursive: true })
  }

  if (imagePath.trim() && window.henjiNative) {
    try {
      const { bytes } = await window.henjiNative.image.generateThumbnailBytes({ source: imagePath })
      await writeFile(cachePath, bytes)
      return cachePath
    } catch {
      // 主进程处理失败（如路径不在协议白名单内），走下面的渲染层后备逻辑
    }
  }

  return generateImageThumbnailFallback(imageUrl, cachePath)
}

function generateImageThumbnailFallback(imageUrl: string, cachePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    const timeout = setTimeout(() => {
      reject(new Error('Image thumbnail generation timeout'))
    }, 15000)

    img.onload = async () => {
      try {
        clearTimeout(timeout)

        const MAX_SIZE = 200
        let width = img.naturalWidth
        let height = img.naturalHeight

        if (width === 0 || height === 0) {
          reject(new Error('Image dimensions are zero'))
          return
        }

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
        if (!ctx) {
          reject(new Error('Failed to get canvas context'))
          return
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        const blob = await new Promise<Blob | null>(res =>
          canvas.toBlob(res, 'image/webp', 0.8)
        )
        if (!blob) {
          reject(new Error('Failed to create image thumbnail blob'))
          return
        }

        const arrayBuffer = await blob.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)

        await writeFile(cachePath, uint8Array)
        resolve(cachePath)
      } catch (err) {
        clearTimeout(timeout)
        reject(err)
      }
    }

    img.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Failed to load image for thumbnail'))
    }

    img.src = imageUrl
  })
}

export async function getOrCreateImageThumbnail(
  imagePath: string,
  imageUrl?: string
): Promise<CachedThumbnailResult> {
  const cachePath = await getImageThumbnailCachePath(imagePath)
  const cacheExists = await exists(cachePath)

  if (cacheExists) {
    return { filePath: cachePath, displaySrc: toDisplaySrc(cachePath) }
  }

  const url = imageUrl || toDisplaySrc(imagePath)
  const generatedPath = await generateAndCacheImageThumbnail(imagePath, url)

  return { filePath: generatedPath, displaySrc: toDisplaySrc(generatedPath) }
}
