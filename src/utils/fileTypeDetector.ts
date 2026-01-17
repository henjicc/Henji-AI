/**
 * 通用文件类型检测工具
 *
 * 检测优先级：
 * 1. HTTP Content-Type 响应头
 * 2. 文件头魔数检测
 * 3. URL 扩展名匹配
 * 4. 媒体类型默认值
 */

/**
 * 媒体类型枚举
 */
export type MediaType = 'image' | 'video' | 'audio'

/**
 * 文件类型检测结果
 */
export interface FileTypeResult {
  extension: string      // 文件扩展名（不含点）
  mimeType?: string      // MIME 类型
  detectionMethod: 'content-type' | 'magic-number' | 'url' | 'default'
}

/**
 * 常见 MIME 类型到扩展名的映射
 */
const MIME_TO_EXT: Record<string, string> = {
  // 图片
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',

  // 视频
  'video/mp4': 'mp4',
  'video/mpeg': 'mpeg',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',

  // 音频
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/webm': 'webm'
}

/**
 * 文件魔数（文件头）检测
 * 只检测前几个字节即可识别文件类型
 */
const MAGIC_NUMBERS: Array<{
  bytes: number[]
  extension: string
  offset?: number
}> = [
  // 图片格式
  { bytes: [0xFF, 0xD8, 0xFF], extension: 'jpg' },
  { bytes: [0x89, 0x50, 0x4E, 0x47], extension: 'png' },
  { bytes: [0x47, 0x49, 0x46, 0x38], extension: 'gif' },
  { bytes: [0x52, 0x49, 0x46, 0x46], extension: 'webp' }, // RIFF (需要进一步检查)
  { bytes: [0x42, 0x4D], extension: 'bmp' },

  // 视频格式
  { bytes: [0x00, 0x00, 0x00], extension: 'mp4', offset: 4 }, // ftyp
  { bytes: [0x1A, 0x45, 0xDF, 0xA3], extension: 'mkv' },
  { bytes: [0x52, 0x49, 0x46, 0x46], extension: 'avi' }, // RIFF (需要进一步检查)

  // 音频格式
  { bytes: [0xFF, 0xFB], extension: 'mp3' },
  { bytes: [0xFF, 0xF3], extension: 'mp3' },
  { bytes: [0xFF, 0xF2], extension: 'mp3' },
  { bytes: [0x49, 0x44, 0x33], extension: 'mp3' }, // ID3
  { bytes: [0x52, 0x49, 0x46, 0x46], extension: 'wav' }, // RIFF (需要进一步检查)
  { bytes: [0x4F, 0x67, 0x67, 0x53], extension: 'ogg' }
]

/**
 * 媒体类型的默认扩展名
 */
const DEFAULT_EXTENSIONS: Record<MediaType, string> = {
  image: 'png',
  video: 'mp4',
  audio: 'wav'
}

/**
 * 方法1: 从 Content-Type 响应头检测文件类型
 */
export function detectFromContentType(contentType: string | null | undefined): string | null {
  if (!contentType) return null

  // 移除参数部分（如 "image/jpeg; charset=utf-8" -> "image/jpeg"）
  const mimeType = contentType.split(';')[0].trim().toLowerCase()

  return MIME_TO_EXT[mimeType] || null
}

/**
 * 方法2: 从文件头（魔数）检测文件类型
 * @param buffer 文件的前几个字节（建议至少 4KB）
 */
export function detectFromMagicNumber(buffer: Uint8Array): string | null {
  if (!buffer || buffer.length === 0) return null

  for (const magic of MAGIC_NUMBERS) {
    const offset = magic.offset || 0
    let matches = true

    for (let i = 0; i < magic.bytes.length; i++) {
      if (buffer[offset + i] !== magic.bytes[i]) {
        matches = false
        break
      }
    }

    if (matches) {
      // 特殊处理 RIFF 格式（需要检查子类型）
      if (magic.extension === 'webp' || magic.extension === 'avi' || magic.extension === 'wav') {
        return detectRIFFSubtype(buffer)
      }
      return magic.extension
    }
  }

  return null
}

/**
 * 检测 RIFF 格式的子类型
 * RIFF 格式包括：WEBP, AVI, WAV 等
 */
function detectRIFFSubtype(buffer: Uint8Array): string | null {
  if (buffer.length < 12) return null

  // RIFF 格式：前4字节是 "RIFF"，第8-11字节是子类型
  const subtype = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11])

  switch (subtype) {
    case 'WEBP':
      return 'webp'
    case 'AVI ':
      return 'avi'
    case 'WAVE':
      return 'wav'
    default:
      return null
  }
}

/**
 * 方法3: 从 URL 中提取扩展名
 */
export function detectFromURL(url: string): string | null {
  if (!url) return null

  try {
    // 移除查询参数和哈希
    const urlWithoutParams = url.split('?')[0].split('#')[0]

    // 提取文件名
    const fileName = urlWithoutParams.split('/').pop()
    if (!fileName) return null

    // 提取扩展名
    const parts = fileName.split('.')
    if (parts.length < 2) return null

    const ext = parts.pop()?.toLowerCase()
    return ext || null
  } catch {
    return null
  }
}

/**
 * 方法4: 使用媒体类型的默认扩展名
 */
export function getDefaultExtension(mediaType: MediaType): string {
  return DEFAULT_EXTENSIONS[mediaType]
}

/**
 * 综合检测文件类型（主入口函数）
 *
 * @param options 检测选项
 * @returns 文件类型检测结果
 */
export async function detectFileType(options: {
  url: string
  mediaType: MediaType
  contentType?: string | null
  fileBuffer?: Uint8Array
}): Promise<FileTypeResult> {
  const { url, mediaType, contentType, fileBuffer } = options

  // 优先级1: Content-Type
  if (contentType) {
    const ext = detectFromContentType(contentType)
    if (ext) {
      return {
        extension: ext,
        mimeType: contentType,
        detectionMethod: 'content-type'
      }
    }
  }

  // 优先级2: 文件头魔数
  if (fileBuffer) {
    const ext = detectFromMagicNumber(fileBuffer)
    if (ext) {
      return {
        extension: ext,
        detectionMethod: 'magic-number'
      }
    }
  }

  // 优先级3: URL 扩展名
  const urlExt = detectFromURL(url)
  if (urlExt) {
    return {
      extension: urlExt,
      detectionMethod: 'url'
    }
  }

  // 优先级4: 默认扩展名
  return {
    extension: getDefaultExtension(mediaType),
    detectionMethod: 'default'
  }
}
