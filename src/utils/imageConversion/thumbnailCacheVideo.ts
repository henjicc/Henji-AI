import { exists, mkdir, toDisplaySrc, writeFile } from '@/platform/desktopApi'
import { getVideoThumbnailCachePath } from './thumbnailCachePaths'
import type { CachedThumbnailResult } from './thumbnailCacheImage'

export async function generateAndCacheVideoThumbnail(videoPath: string, videoUrl: string): Promise<string> {
  const { getThumbnailsPath } = await import('@/utils/dataPath')

  const cachePath = await getVideoThumbnailCachePath(videoPath)

  const thumbnailsDir = await getThumbnailsPath()
  const dirExists = await exists(thumbnailsDir)
  if (!dirExists) {
    await mkdir(thumbnailsDir, { recursive: true })
  }

  if (videoPath.trim() && window.henjiNative) {
    try {
      const { bytes } = await window.henjiNative.video.generateThumbnailBytes({ source: videoPath })
      await writeFile(cachePath, bytes)
      return cachePath
    } catch {
      // 主进程处理失败（如路径不在协议白名单内），走下面的渲染层后备逻辑
    }
  }

  return generateVideoThumbnailFallback(videoUrl, cachePath)
}

function generateVideoThumbnailFallback(videoUrl: string, cachePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'

    const timeout = setTimeout(() => {
      reject(new Error('Video thumbnail generation timeout'))
    }, 15000)

    const captureFrame = async () => {
      try {
        clearTimeout(timeout)

        const MAX_SIZE = 200
        let width = video.videoWidth
        let height = video.videoHeight

        if (width === 0 || height === 0) {
          reject(new Error('Video dimensions are zero'))
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

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        const blob = await new Promise<Blob | null>(res =>
          canvas.toBlob(res, 'image/webp', 0.8)
        )
        if (!blob) {
          reject(new Error('Failed to create video thumbnail blob'))
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

    video.onloadedmetadata = () => {
      video.currentTime = 0.1
    }

    video.onseeked = () => {
      setTimeout(() => {
        void captureFrame()
      }, 200)
    }

    video.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Failed to load video for thumbnail'))
    }

    video.src = videoUrl
    video.load()
  })
}

export async function getOrCreateVideoThumbnail(
  videoPath: string,
  videoUrl?: string
): Promise<CachedThumbnailResult> {
  const cachePath = await getVideoThumbnailCachePath(videoPath)
  const cacheExists = await exists(cachePath)

  if (cacheExists) {
    return { filePath: cachePath, displaySrc: toDisplaySrc(cachePath) }
  }

  const url = videoUrl || toDisplaySrc(videoPath)
  const generatedPath = await generateAndCacheVideoThumbnail(videoPath, url)

  return { filePath: generatedPath, displaySrc: toDisplaySrc(generatedPath) }
}
