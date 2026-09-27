import { createLogger } from '@/core/logging'
import { basename, dirname, exists, join, mkdir, toDisplaySrc, writeFile } from '@/platform/desktopApi'

const logger = createLogger('utils.historyThumbnail')
const pendingThumbnails = new Map<string, Promise<string | undefined>>()
const thumbnailWaiters = new Set<() => void>()
let activeThumbnails = 0

/**
 * Get the cache path for a history thumbnail (540px max, stored in /540/ subdirectory)
 */
export async function getHistoryThumbnailCachePath(imagePath: string, thumbnailsDir?: string): Promise<string> {
  if (thumbnailsDir === undefined) {
    const { getThumbnailsPath } = await import('@/utils/dataPath')
    thumbnailsDir = await getThumbnailsPath()
  }
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
  imageUrl?: string,
  thumbnailsDir?: string,
): Promise<string | undefined> {
  const key = JSON.stringify([imagePath, imageUrl, thumbnailsDir])
  const pending = pendingThumbnails.get(key)
  if (pending) return pending
  const work = (async () => {
    if (activeThumbnails >= 2) await new Promise<void>((resolve) => thumbnailWaiters.add(resolve))
    else activeThumbnails++
    try {
      return await generateHistoryThumbnail(imagePath, imageUrl, thumbnailsDir)
    } finally {
      pendingThumbnails.delete(key)
      const next = thumbnailWaiters.values().next().value
      if (next) { thumbnailWaiters.delete(next); next() }
      else activeThumbnails--
    }
  })()
  pendingThumbnails.set(key, work)
  return work
}

/** 每批只解析一次目录、只排入两项工作；取消后不再解码剩余图片。 */
export async function prepareHistoryThumbnails(
  paths: Iterable<string>,
  isCancelled: () => boolean,
): Promise<void> {
  const { getThumbnailsPath } = await import('@/utils/dataPath')
  const thumbnailsDir = await getThumbnailsPath()
  const iterator = new Set(paths).values()
  const worker = async () => {
    while (!isCancelled()) {
      const next = iterator.next()
      if (next.done) return
      await getOrCreateHistoryThumbnail(next.value, undefined, thumbnailsDir)
    }
  }
  await Promise.all([worker(), worker()])
}

async function generateHistoryThumbnail(
  imagePath: string,
  imageUrl?: string,
  thumbnailsDir?: string,
): Promise<string | undefined> {
  try {
    const cachePath = await getHistoryThumbnailCachePath(imagePath, thumbnailsDir)
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
      let loadingFinished = false
      const stopLoading = () => { loadingFinished = true; img.onload = null; img.onerror = null }
      const timeout = setTimeout(() => {
        stopLoading()
        img.src = ''
        reject(new Error('History thumbnail generation timeout'))
      }, 15000)

      img.onload = async () => {
        if (loadingFinished) return
        stopLoading()
        let canvas: HTMLCanvasElement | undefined
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

          canvas = document.createElement('canvas')
          canvas.width = Math.floor(width)
          canvas.height = Math.floor(height)
          const ctx = canvas.getContext('2d')
          if (!ctx) { reject(new Error('Failed to get canvas context')); return }

          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

          const target = canvas
          const blob = await new Promise<Blob | null>(res => target.toBlob(res, 'image/webp', 0.8))
          if (!blob) { reject(new Error('Failed to create blob')); return }

          const buffer = await blob.arrayBuffer()
          await writeFile(cachePath, new Uint8Array(buffer))
          resolve()
        } catch (err) {
          clearTimeout(timeout)
          reject(err)
        } finally {
          img.src = ''
          if (canvas) { canvas.width = 0; canvas.height = 0 }
        }
      }

      img.onerror = () => {
        if (loadingFinished) return
        stopLoading()
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
