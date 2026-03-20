import { createLogger } from '@/core/logging'

const logger = createLogger('utils.imageConversion.dragThumbnails')

/**
 * 生成缩略图并保存到临时文件
 * 用于拖拽时的图标显示
 */
export async function generateThumbnail(imageUrl: string): Promise<string> {
  try {
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const { tempDir, join } = await import('@tauri-apps/api/path')

    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = imageUrl
    })

    const MAX_SIZE = 100
    let width = img.width
    let height = img.height

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
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get canvas context')

    ctx.drawImage(img, 0, 0, width, height)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/png')
    )
    if (!blob) throw new Error('Failed to create thumbnail blob')

    const arrayBuffer = await blob.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)

    const tempPath = await tempDir()
    const fileName = `drag-thumb-${Date.now()}-${Math.floor(Math.random() * 1000)}.png`
    const filePath = await join(tempPath, fileName)

    await writeFile(filePath, uint8Array)

    return filePath
  } catch (error) {
    logger.error('Failed to generate thumbnail:', error)
    throw error
  }
}

/**
 * 从视频生成缩略图并保存到临时文件
 * 用于拖拽时的图标显示
 */
export async function generateVideoThumbnail(videoUrl: string): Promise<string> {
  try {
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const { tempDir, join } = await import('@tauri-apps/api/path')

    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'metadata'

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('Failed to load video'))
      video.src = videoUrl
    })

    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) {
        resolve()
      } else {
        video.oncanplay = () => resolve()
      }
    })

    const MAX_SIZE = 100
    let width = video.videoWidth
    let height = video.videoHeight

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
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get canvas context')

    ctx.drawImage(video, 0, 0, width, height)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/png')
    )
    if (!blob) throw new Error('Failed to create video thumbnail blob')

    const arrayBuffer = await blob.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)

    const tempPath = await tempDir()
    const fileName = `drag-video-thumb-${Date.now()}-${Math.floor(Math.random() * 1000)}.webp`
    const filePath = await join(tempPath, fileName)

    await writeFile(filePath, uint8Array)

    return filePath
  } catch (error) {
    logger.error('Failed to generate video thumbnail:', error)
    throw error
  }
}

/**
 * 从视频生成预览用的 Data URL
 * 用于在 img 标签中显示（窗口内拖放预览）
 */
export async function generateVideoPreviewDataUrl(videoUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'

    const timeout = setTimeout(() => {
      reject(new Error('Video preview generation timeout'))
    }, 15000)

    const captureFrame = () => {
      try {
        clearTimeout(timeout)

        const MAX_SIZE = 100
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

        const dataUrl = canvas.toDataURL('image/webp', 0.8)
        resolve(dataUrl)
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
        captureFrame()
      }, 200)
    }

    video.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Failed to load video'))
    }

    video.src = videoUrl
    video.load()
  })
}


