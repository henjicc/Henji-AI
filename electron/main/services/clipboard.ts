import { clipboard, nativeImage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { resolveSourceBytes } from './image/source'

export interface ClipboardFileEntryDto {
  path: string
  data: string
  mimeType: string
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

export async function writeImageFromPath(filePath: string): Promise<void> {
  const pngBytes = await sharp(await fs.readFile(filePath)).png().toBuffer()
  const image = nativeImage.createFromBuffer(pngBytes)
  if (image.isEmpty()) {
    throw new Error('Failed to decode image for clipboard')
  }
  clipboard.writeImage(image)
}

export async function writeImageFromSource(source: string): Promise<void> {
  const { bytes } = await resolveSourceBytes(source)
  const pngBytes = await sharp(bytes).png().toBuffer()
  const image = nativeImage.createFromBuffer(pngBytes)
  if (image.isEmpty()) {
    throw new Error('Failed to decode image source for clipboard')
  }
  clipboard.writeImage(image)
}
