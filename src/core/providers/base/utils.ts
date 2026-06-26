/**
 * Provider 工具函数库
 *
 * 提供文件处理、URL处理、API密钥管理等通用工具函数
 */

import { readFile } from '@/platform/desktopApi'
import { ProviderError, ProviderErrorCode } from './errors'

/**
 * 将 Data URI 转换为 Blob
 *
 * @param dataURI - Data URI 字符串
 * @returns Blob 对象
 */
export function dataURItoBlob(dataURI: string): Blob {
  try {
    // 分离 MIME 类型和数据部分
    const parts = dataURI.split(',')
    if (parts.length !== 2) {
      throw new Error('Invalid Data URI format')
    }

    const mimeMatch = parts[0].match(/:(.*?);/)
    const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream'
    const isBase64 = parts[0].includes('base64')
    const data = parts[1]

    if (isBase64) {
      // Base64 解码
      const binaryString = atob(data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      return new Blob([bytes], { type: mimeType })
    } else {
      // URL 解码
      const decodedData = decodeURIComponent(data)
      return new Blob([decodedData], { type: mimeType })
    }
  } catch (error) {
    throw new Error(`Failed to convert Data URI to Blob: ${error}`)
  }
}

/**
 * 将 Blob 转换为 Data URI
 *
 * @param blob - Blob 对象
 * @returns Promise<Data URI 字符串>
 */
export async function blobToDataURI(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read Blob'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 将 Blob 转换为 Base64
 *
 * @param blob - Blob 对象
 * @returns Promise<Base64 字符串（不含前缀）>
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const dataURI = await blobToDataURI(blob)
  // 移除 "data:*/*;base64," 前缀
  return dataURI.split(',')[1]
}

/**
 * 读取本地文件为 Blob
 *
 * @param path - 文件路径（支持 asset:// 协议）
 * @returns Promise<Blob 对象>
 */
export async function readLocalFile(path: string): Promise<Blob> {
  try {
    // 移除 asset:// 前缀
    const normalizedPath = path.replace(/^asset:\/\//, '')

    // 使用 Tauri 的 readFile API
    const bytes = await readFile(normalizedPath)

    // 根据文件扩展名推断 MIME 类型
    const mimeType = extractMimeType(path)

    return new Blob([bytes], { type: mimeType })
  } catch (error) {
    throw new Error(`Failed to read local file: ${path} - ${error}`)
  }
}

/**
 * 判断是否为本地文件路径
 *
 * @param path - 路径字符串
 * @returns 是否为本地路径
 */
export function isLocalPath(path: string): boolean {
  // Windows 路径: C:\, D:\, \\network\share
  // macOS/Linux 路径: /Users/, /home/, ~/
  // Tauri asset 协议: asset://
  return (
    /^[a-zA-Z]:\\/.test(path) || // Windows 绝对路径
    /^\\\\/.test(path) || // Windows 网络路径
    /^\//.test(path) || // Unix 绝对路径
    /^~\//.test(path) || // Unix home路径
    /^asset:\/\//.test(path) // Tauri asset协议
  )
}

/**
 * 规范化文件路径
 *
 * @param path - 原始路径
 * @returns 规范化后的路径
 */
export function normalizeFilePath(path: string): string {
  // 移除 asset:// 前缀
  let normalized = path.replace(/^asset:\/\//, '')

  // Windows 路径分隔符统一
  if (/^[a-zA-Z]:\\/.test(normalized)) {
    normalized = normalized.replace(/\//g, '\\')
  }

  return normalized
}

/**
 * 判断是否为 Data URI
 *
 * @param str - 字符串
 * @returns 是否为 Data URI
 */
export function isDataURI(str: string): boolean {
  return /^data:[^;]+;base64,/.test(str) || /^data:[^;]+,/.test(str)
}

/**
 * 判断是否为远程 URL
 *
 * @param str - 字符串
 * @returns 是否为远程 URL
 */
export function isRemoteURL(str: string): boolean {
  return /^https?:\/\//.test(str)
}

/**
 * 从文件路径或 URL 提取 MIME 类型
 *
 * @param source - 文件路径或 URL
 * @returns MIME 类型
 */
export function extractMimeType(source: string): string {
  // 从 Data URI 提取
  if (isDataURI(source)) {
    const match = source.match(/^data:([^;]+);/)
    if (match) return match[1]
  }

  // 从文件扩展名推断
  const ext = source.split('.').pop()?.toLowerCase()

  const mimeMap: Record<string, string> = {
    // 图片
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',

    // 视频
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',

    // 音频
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
  }

  return mimeMap[ext || ''] || 'application/octet-stream'
}

/**
 * 获取 API 密钥
 *
 * @param provider - Provider 名称
 * @returns API 密钥或 null
 */
export function getApiKey(provider: string): string | null {
  const key = `${provider}ApiKey`
  return localStorage.getItem(key)
}

/**
 * 设置 API 密钥
 *
 * @param provider - Provider 名称
 * @param apiKey - API 密钥
 */
export function setApiKey(provider: string, apiKey: string): void {
  const key = `${provider}ApiKey`
  localStorage.setItem(key, apiKey)
}

/**
 * 获取 Fal API 密钥（特殊处理）
 *
 * @returns Fal API 密钥或空字符串
 */
export function getFalApiKey(): string {
  return getApiKey('fal') || ''
}

/**
 * 延迟函数
 *
 * @param ms - 延迟毫秒数
 * @returns Promise<void>
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 重试函数
 *
 * @param fn - 要重试的异步函数
 * @param options - 重试选项
 * @returns Promise<函数返回值>
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts: number
    delay: number
    onRetry?: (attempt: number, error: any) => void
    shouldRetry?: (error: any) => boolean
  }
): Promise<T> {
  const { maxAttempts, delay, onRetry, shouldRetry = () => true } = options

  let lastError: any

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // 检查是否应该重试
      if (!shouldRetry(error)) {
        throw error
      }

      // 最后一次尝试失败后不再等待
      if (attempt < maxAttempts) {
        onRetry?.(attempt, error)
        await sleep(delay)
      }
    }
  }

  throw lastError
}

/**
 * 格式化文件大小
 *
 * @param bytes - 字节数
 * @returns 格式化后的字符串
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`
}

/**
 * 生成随机文件名
 *
 * @param prefix - 前缀
 * @param ext - 扩展名（不含点）
 * @returns 文件名
 */
export function generateFilename(prefix: string = 'file', ext: string = 'bin'): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${timestamp}_${random}.${ext}`
}

/**
 * 从 URL 提取文件扩展名
 *
 * @param url - URL 字符串
 * @returns 扩展名（不含点）或 null
 */
export function extractExtension(url: string): string | null {
  try {
    const pathname = new URL(url).pathname
    const match = pathname.match(/\.([^.]+)$/)
    return match ? match[1] : null
  } catch {
    // 如果不是有效URL，尝试直接匹配
    const match = url.match(/\.([^.]+)$/)
    return match ? match[1] : null
  }
}
