import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readImageInfo } from '../image/ops'
import { loadFfprobePath } from '../video/ffmpeg-loader'
import { readVideoInfo } from '../video/ops'
import type { AssetMediaType } from './types'

export interface MediaInspectionResult {
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  durationSeconds: number | null
  fileModifiedAt: number
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
}

function readAudioDuration(filePath: string): Promise<number> {
  return loadFfprobePath().then((binary) => new Promise((resolve, reject) => {
    execFile(binary, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath], (error, stdout) => {
      if (error) return reject(error)
      const duration = Number(stdout.trim())
      return Number.isFinite(duration) && duration > 0 ? resolve(duration) : reject(new Error('Unable to read audio duration'))
    })
  }))
}

export function normalizeAssetPath(filePath: string): string {
  const value = filePath.trim()
  if (/^(blob:|data:|https?:)/i.test(value)) throw new Error('资产必须引用已落盘的本地文件')
  if (!path.isAbsolute(value) || value.includes('\0')) throw new Error('资产路径必须是有效绝对路径')
  const normalized = path.normalize(path.resolve(value))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export async function inspectMedia(filePath: string, mediaType: AssetMediaType): Promise<MediaInspectionResult> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('Asset path is not a file')
  let width: number | null = null
  let height: number | null = null
  let durationSeconds: number | null = null
  if (mediaType === 'image') {
    const info = await readImageInfo(filePath)
    width = info.width
    height = info.height
  } else if (mediaType === 'video') {
    const info = await readVideoInfo(filePath)
    width = info.width || null
    height = info.height || null
    durationSeconds = info.durationSeconds
  } else {
    durationSeconds = await readAudioDuration(filePath)
  }
  return { mimeType: MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream', sizeBytes: stat.size, width, height, durationSeconds, fileModifiedAt: stat.mtimeMs }
}
