import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { AiRuntimeError } from '@henjicc/ai-sdk'

import {
  acquireManagedMediaFileLease,
  releaseManagedMediaFileLease,
} from '../image/managed-media-leases'
import { getDataRootDir } from '../image/path-utils'

export async function saveMediaFromUrl(url: string): Promise<string | undefined> {
  return (await saveMediaFromUrlTracked(url))?.filePath
}

export interface SavedMediaFile {
  filePath: string
  /** true 表示本次调用取得了一个可释放租约；文件也可能由同进程的更早调用创建。 */
  created: boolean
}

/** 下载并报告本次调用是否取得可释放租约，供上层做精确所有权回收。 */
export async function saveMediaFromUrlTracked(url: string): Promise<SavedMediaFile | undefined> {
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
  const mediaDir = path.join(getDataRootDir(), 'Media')
  await fs.mkdir(mediaDir, { recursive: true })
  const filePath = path.join(mediaDir, fileName)
  const leased = await acquireManagedMediaFileLease(filePath, async () => {
    try {
      await fs.writeFile(filePath, bytes, { flag: 'wx' })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    }
  })
  return { filePath, created: leased }
}

/** 回滚由 saveMediaFromUrlTracked 取得的一次租约；无租约的历史文件保持不动。 */
export async function releaseSavedMediaFileLease(filePath: string): Promise<void> {
  if (releaseManagedMediaFileLease(filePath) === 'delete') {
    await fs.rm(filePath, { force: true })
  }
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
