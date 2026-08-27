/**
 * 媒体二进制的解析/推断工具：`data:` URI 解码、按扩展名推断 MIME、缺省文件名。
 *
 * 三者都是纯函数、不触碰文件系统，因此既被 SDK 内部的 `preprocess.ts`（处理请求体里的
 * `data:` URI 分支）使用，也导出给宿主的 `MediaReader` 实现复用——Electron 侧
 * `electron/main/services/ai-runtime/sdk-runtime.ts` 此前维护了一份几乎一样的临时拷贝
 * （2.1 产出时的注释就说明了这一点），本任务（2.4）统一到这一份，删除宿主侧的重复实现。
 */

import { AiRuntimeError } from '../runtime/AiRuntimeError'

import { fromBase64 } from './base64'
import type { MediaKind } from './media-fields'

export interface ParsedDataUri {
  bytes: Uint8Array
  mimeType: string
}

/** 解析 `data:` URI；不是 `data:` URI 时返回 `undefined`，格式非法时 throw。 */
export function parseDataUri(input: string): ParsedDataUri | undefined {
  if (!input.startsWith('data:')) return undefined
  const commaIndex = input.indexOf(',')
  if (commaIndex < 0) throw new AiRuntimeError('invalid_data_uri', 'Invalid data URI format')
  const header = input.slice(0, commaIndex)
  const payload = input.slice(commaIndex + 1)
  const mimeType = header.slice(5).split(';')[0] || 'application/octet-stream'
  const bytes = header.includes(';base64')
    ? fromBase64(payload)
    : new TextEncoder().encode(decodeURIComponent(payload))
  return { bytes, mimeType }
}

/**
 * 按扩展名推断 MIME 类型，纯字符串处理、不依赖 Node path 模块（UXP 没有 Node 模块解析器）。
 * 先去掉查询串/片段（形如 `...jpg?x-oss-token=...`），再取最后一个路径分隔符之后、
 * 最后一个 `.` 之后的部分；取不到扩展名（或形如 `.gitignore` 的纯隐藏文件名）时按
 * `mediaKind` 退化成一个合理的默认值。
 */
export function inferMimeFromPath(filePath: string, mediaKind: MediaKind = 'unknown'): string {
  const ext = extractExtension(filePath)
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    case 'mp4': return 'video/mp4'
    case 'webm': return 'video/webm'
    case 'mov': return 'video/quicktime'
    case 'mp3': return 'audio/mpeg'
    case 'm4a': return 'audio/mp4'
    case 'wav': return 'audio/wav'
    case 'flac': return 'audio/flac'
    case 'ogg': return 'audio/ogg'
    default:
      if (mediaKind === 'image') return 'image/jpeg'
      if (mediaKind === 'video') return 'video/mp4'
      if (mediaKind === 'audio') return 'audio/mpeg'
      return 'application/octet-stream'
  }
}

function extractExtension(filePath: string): string {
  const withoutQuery = filePath.split(/[?#]/)[0] ?? filePath
  const lastSlash = Math.max(withoutQuery.lastIndexOf('/'), withoutQuery.lastIndexOf('\\'))
  const basename = lastSlash >= 0 ? withoutQuery.slice(lastSlash + 1) : withoutQuery
  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex <= 0) return ''
  return basename.slice(dotIndex + 1).toLowerCase()
}

export function defaultFilename(mimeType: string, mediaKind: MediaKind = 'unknown'): string {
  const ext = mimeType.includes('png') ? 'png'
    : mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg'
      : mimeType.includes('webp') ? 'webp'
        : mimeType.includes('audio/mp4') ? 'm4a'
          : mimeType.includes('mp4') ? 'mp4'
            : mimeType.includes('webm') ? 'webm'
              : mimeType.includes('mpeg') ? 'mp3'
                : mimeType.includes('wav') ? 'wav'
                  : 'bin'
  const prefix = mediaKind === 'unknown' ? 'file' : mediaKind
  return `${prefix}_${Date.now()}.${ext}`
}
