import { clipboard, nativeImage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveSourceBytes } from './image/source'
import { loadSharp } from './image/sharp-loader'

export interface ClipboardFileEntryDto {
  path: string
  data: string
  mimeType: string
}

export interface ClipboardImageDto {
  /** 统一为 data URL，调用方不需要关心剪贴板里原本是位图还是文件 */
  dataUrl: string
  /** 建议文件名，来自文件路径；位图截图则生成时间戳名 */
  name: string
  /** bitmap = 截图等原始位图；file = 从资源管理器复制的图片文件 */
  origin: 'bitmap' | 'file'
}

function inferMimeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.avi')) return 'video/x-msvideo'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.flac')) return 'audio/flac'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  return 'application/octet-stream'
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  return paths.filter((filePath) => {
    const normalized = path.normalize(filePath)
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function parseNullSeparated(value: string): string[] {
  return value
    .split('\0')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function readWindowsClipboardFilePaths(): string[] {
  const unicode = clipboard.readBuffer('FileNameW')
  if (unicode.length > 0) {
    return parseNullSeparated(unicode.toString('utf16le').replace(/\0+$/g, ''))
  }

  const ansi = clipboard.readBuffer('FileName')
  if (ansi.length > 0) {
    return parseNullSeparated(ansi.toString('utf8').replace(/\0+$/g, ''))
  }

  return []
}

function readMacClipboardFilePaths(): string[] {
  const text = clipboard.read('NSFilenamesPboardType')
  if (!text) return []

  const quoted = Array.from(text.matchAll(/"([^"]+)"/g), (match) => match[1])
  if (quoted.length > 0) return quoted

  return text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith('/'))
}

function readClipboardFilePaths(): string[] {
  const paths = process.platform === 'darwin'
    ? readMacClipboardFilePaths()
    : readWindowsClipboardFilePaths()
  return uniquePaths(paths.filter((filePath) => path.isAbsolute(filePath)))
}

export async function readClipboardFiles(): Promise<ClipboardFileEntryDto[]> {
  const entries: ClipboardFileEntryDto[] = []
  for (const filePath of readClipboardFilePaths()) {
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) continue
      const bytes = await fs.readFile(filePath)
      entries.push({
        path: filePath,
        data: bytes.toString('base64'),
        mimeType: inferMimeFromPath(filePath),
      })
    } catch {
      // Clipboard file lists may contain transient shell items; skip unreadable entries.
    }
  }
  return entries
}

export function readClipboardText(): string {
  return clipboard.readText()
}

/**
 * 主动从剪贴板取一张图片。
 *
 * 两种来源都要覆盖：截图之类的原始位图走 `readImage()`，从资源管理器复制的图片文件
 * 走已有的文件列表读取。判断顺序放在这里而不是各调用方，避免每个界面各写一遍。
 * 剪贴板里没有图片时返回 null，由调用方决定怎么提示。
 */
export async function readClipboardImage(): Promise<ClipboardImageDto | null> {
  const image = clipboard.readImage()
  if (!image.isEmpty()) {
    return {
      dataUrl: image.toDataURL(),
      name: `clipboard-${Date.now()}.png`,
      origin: 'bitmap',
    }
  }

  for (const entry of await readClipboardFiles()) {
    if (!entry.mimeType.startsWith('image/')) continue
    return {
      dataUrl: `data:${entry.mimeType};base64,${entry.data}`,
      name: path.basename(entry.path),
      origin: 'file',
    }
  }

  return null
}

export async function writeImageFromPath(filePath: string): Promise<void> {
  const sharp = await loadSharp()
  const pngBytes = await sharp(await fs.readFile(filePath)).png().toBuffer()
  const image = nativeImage.createFromBuffer(pngBytes)
  if (image.isEmpty()) {
    throw new Error('Failed to decode image for clipboard')
  }
  clipboard.writeImage(image)
}

export async function writeImageFromSource(source: string): Promise<void> {
  const { bytes } = await resolveSourceBytes(source)
  const sharp = await loadSharp()
  const pngBytes = await sharp(bytes).png().toBuffer()
  const image = nativeImage.createFromBuffer(pngBytes)
  if (image.isEmpty()) {
    throw new Error('Failed to decode image source for clipboard')
  }
  clipboard.writeImage(image)
}
