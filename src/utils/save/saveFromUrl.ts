import { mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import * as path from '@tauri-apps/api/path'
import { convertFileSrc } from '@tauri-apps/api/core'
import { getMediaPath } from '@/utils/dataPath'
import { logError, logInfo, logWarning } from '@/utils/errorLogger'
import { detectFileType } from '@/utils/fileTypeDetector'

export async function saveBinary(
  data: Uint8Array,
  filename: string
): Promise<{ fullPath: string; webSrc: string }> {
  const mediaPath = await getMediaPath()
  const fullPath = await path.join(mediaPath, filename)
  await mkdir(mediaPath, { recursive: true })
  await writeFile(fullPath, data)
  const webSrc = convertFileSrc(fullPath)
  logInfo('[save] wrote file', fullPath)
  return { fullPath, webSrc }
}

export async function saveImageFromUrl(
  url: string,
  filename?: string
): Promise<{ fullPath: string; webSrc: string }> {
  const res = await httpFetch(url, { method: 'GET' })
  const buf = await res.arrayBuffer()
  const array = new Uint8Array(buf)

  const contentType = res.headers.get('content-type')
  const fileBuffer = array.length > 4096 ? array.slice(0, 4096) : array

  const fileType = await detectFileType({
    url,
    mediaType: 'image',
    contentType,
    fileBuffer
  })

  logInfo('[save] 检测到图片类型:', {
    extension: fileType.extension,
    method: fileType.detectionMethod,
    contentType: fileType.mimeType
  })

  const name = filename ?? `image-${Date.now()}.${fileType.extension}`
  const saved = await saveBinary(array, name)
  logInfo('[save] image saved', saved.fullPath)
  return saved
}

export async function saveVideoFromUrl(
  url: string,
  filename?: string
): Promise<{ fullPath: string; webSrc: string }> {
  const maxRetries = 5
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logInfo(`[save] 尝试保存视频 (第 ${attempt}/${maxRetries} 次)`, url)

      const res = await httpFetch(url, { method: 'GET' })
      const buf = await res.arrayBuffer()
      const array = new Uint8Array(buf)

      const contentType = res.headers.get('content-type')
      const fileBuffer = array.length > 4096 ? array.slice(0, 4096) : array

      const fileType = await detectFileType({
        url,
        mediaType: 'video',
        contentType,
        fileBuffer
      })

      logInfo('[save] 检测到视频类型:', {
        extension: fileType.extension,
        method: fileType.detectionMethod,
        contentType: fileType.mimeType
      })

      const name = filename ?? `video-${Date.now()}.${fileType.extension}`
      const saved = await saveBinary(array, name)
      logInfo('[save] video saved', saved.fullPath)
      return saved
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      logWarning(`[save] 视频保存失败 (第 ${attempt}/${maxRetries} 次)`, {
        error: lastError.message,
        url
      })

      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
        logInfo(`[save] 等待 ${delayMs}ms 后重试...`, { delayMs })
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  const errorMessage = `视频保存失败，已尝试 ${maxRetries} 次。最后的错误: ${lastError?.message || '未知错误'}`
  logError('[save] 视频保存最终失败', {
    url,
    attempts: maxRetries,
    error: lastError?.message,
    stack: lastError?.stack
  })
  console.error(`[save] ${errorMessage}`)
  console.error('[save] 错误详情:', lastError)

  throw new Error(errorMessage)
}

export async function saveAudioFromUrl(
  url: string,
  filename?: string
): Promise<{ fullPath: string; webSrc: string }> {
  const res = await httpFetch(url, { method: 'GET' })
  const buf = await res.arrayBuffer()
  const array = new Uint8Array(buf)

  const contentType = res.headers.get('content-type')
  const fileBuffer = array.length > 4096 ? array.slice(0, 4096) : array

  const fileType = await detectFileType({
    url,
    mediaType: 'audio',
    contentType,
    fileBuffer
  })

  logInfo('[save] 检测到音频类型:', {
    extension: fileType.extension,
    method: fileType.detectionMethod,
    contentType: fileType.mimeType
  })

  const name = filename ?? `audio-${Date.now()}.${fileType.extension}`
  const saved = await saveBinary(array, name)
  logInfo('[save] audio saved', saved.fullPath)
  return saved
}

