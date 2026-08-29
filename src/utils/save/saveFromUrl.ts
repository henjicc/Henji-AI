import { createLogger } from '@/core/logging'
import {
  exists,
  join,
  mkdir,
  nativeFetch as httpFetch,
  toDisplaySrc,
  writeFile,
} from '@/platform/desktopApi'
import { getMediaPath } from '@/utils/dataPath'
import { detectFileType } from '@/utils/fileTypeDetector'

const logger = createLogger('utils.save.saveFromUrl')

export async function saveBinary(
  data: Uint8Array,
  filename: string,
  options?: { exclusive?: boolean }
): Promise<{ fullPath: string; webSrc: string; created: boolean }> {
  const mediaPath = await getMediaPath()
  const fullPath = await join(mediaPath, filename)
  await mkdir(mediaPath, { recursive: true })
  const exclusive = options?.exclusive === true
  const created = exclusive || !(await exists(fullPath))
  await writeFile(fullPath, data, { exclusive })
  const webSrc = toDisplaySrc(fullPath)
  logger.info('[save] wrote file', fullPath)
  return { fullPath, webSrc, created }
}

export async function saveImageFromUrl(
  url: string,
  filename?: string
): Promise<{ fullPath: string; webSrc: string; created: boolean }> {
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

  logger.info('[save] 检测到图片类型:', {
    extension: fileType.extension,
    method: fileType.detectionMethod,
    contentType: fileType.mimeType
  })

  const name = filename ?? `image-${globalThis.crypto.randomUUID()}.${fileType.extension}`
  const saved = await saveBinary(array, name, { exclusive: filename === undefined })
  logger.info('[save] image saved', saved.fullPath)
  return saved
}

export async function saveVideoFromUrl(
  url: string,
  filename?: string
): Promise<{ fullPath: string; webSrc: string; created: boolean }> {
  const maxRetries = 5
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[save] 尝试保存视频 (第 ${attempt}/${maxRetries} 次)`, url)

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

      logger.info('[save] 检测到视频类型:', {
        extension: fileType.extension,
        method: fileType.detectionMethod,
        contentType: fileType.mimeType
      })

      const name = filename ?? `video-${globalThis.crypto.randomUUID()}.${fileType.extension}`
      const saved = await saveBinary(array, name, { exclusive: filename === undefined })
      logger.info('[save] video saved', saved.fullPath)
      return saved
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      logger.warn(`[save] 视频保存失败 (第 ${attempt}/${maxRetries} 次)`, {
        error: lastError.message,
        url
      })

      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
        logger.info(`[save] 等待 ${delayMs}ms 后重试...`, { delayMs })
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  const errorMessage = `视频保存失败，已尝试 ${maxRetries} 次。最后的错误: ${lastError?.message || '未知错误'}`
  logger.error('[save] 视频保存最终失败', {
    url,
    attempts: maxRetries,
    error: lastError?.message,
    stack: lastError?.stack
  })
  logger.error(`[save] ${errorMessage}`)
  logger.error('[save] 错误详情:', lastError)

  throw new Error(errorMessage)
}

export async function saveAudioFromUrl(
  url: string,
  filename?: string
): Promise<{ fullPath: string; webSrc: string; created: boolean }> {
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

  logger.info('[save] 检测到音频类型:', {
    extension: fileType.extension,
    method: fileType.detectionMethod,
    contentType: fileType.mimeType
  })

  const name = filename ?? `audio-${globalThis.crypto.randomUUID()}.${fileType.extension}`
  const saved = await saveBinary(array, name, { exclusive: filename === undefined })
  logger.info('[save] audio saved', saved.fullPath)
  return saved
}
