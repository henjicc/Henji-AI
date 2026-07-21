import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getHenjiDataDir } from '../db'
import { AiRuntimeError } from './errors'

export async function saveMediaFromUrl(url: string): Promise<string | undefined> {
  if (!url.trim()) {
    return undefined
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new AiRuntimeError('media_download_failed', `HTTP ${response.status} while downloading media`)
  }

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
  const bytes = new Uint8Array(await response.arrayBuffer())
  const fileName = buildFileName(url, bytes, contentType)
  const mediaDir = path.join(getHenjiDataDir(), 'Media')
  await fs.mkdir(mediaDir, { recursive: true })
  const filePath = path.join(mediaDir, fileName)
  await fs.writeFile(filePath, bytes)
  return filePath
}

function buildFileName(url: string, bytes: Uint8Array, contentType: string): string {
  const digest = createHash('md5').update(bytes).digest('hex')
  return `ai_${digest.slice(0, 16)}.${inferExtension(url, contentType)}`
}

function inferExtension(url: string, contentType: string): string {
  const lowerUrl = url.toLowerCase()
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mp3', 'wav']) {
    if (lowerUrl.includes(`.${ext}`)) {
      return ext
    }
  }
  if (contentType.includes('image/png')) return 'png'
  if (contentType.includes('image/jpeg')) return 'jpg'
  if (contentType.includes('image/webp')) return 'webp'
  if (contentType.includes('video/mp4')) return 'mp4'
  if (contentType.includes('video/webm')) return 'webm'
  if (contentType.includes('audio/mpeg')) return 'mp3'
  if (contentType.includes('audio/wav')) return 'wav'
  return 'bin'
}
