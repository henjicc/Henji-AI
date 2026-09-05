import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { AiRuntimeError } from '@henjicc/ai-sdk'

import {
  acquireManagedMediaFileLease,
  releaseManagedMediaFileLease,
} from '../image/managed-media-leases'
import { getDataRootDir } from '../image/path-utils'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.ai_runtime.media_download')
const DOWNLOAD_ATTEMPTS = 3
const DOWNLOAD_TIMEOUT_MS = 120_000

export interface MediaDownloadContext {
  requestId: string
  modelId?: string
  taskId?: string
  outputIndex?: number
}

class MediaHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status} while downloading media`)
  }
}

function isTransientDownloadError(error: unknown): boolean {
  if (error instanceof MediaHttpError) return [408, 429].includes(error.status) || error.status >= 500
  if (!(error instanceof Error) || error.name === 'AbortError') return false
  const cause = error.cause as { code?: string } | undefined
  return error instanceof TypeError || error.name === 'TimeoutError'
    || ['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(cause?.code ?? '')
}

async function downloadMedia(
  url: string,
  context: MediaDownloadContext,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { outputIndex, ...identity } = context
  logger.info('开始下载生成结果', {
    event: 'ai_runtime.media_download.start', ...identity, context: { outputIndex },
  })
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new MediaHttpError(response.status)
      }
      // 响应头成功不代表文件完整；body 中途断流也必须重取整个文件。
      const bytes = new Uint8Array(await response.arrayBuffer())
      logger.info('生成结果下载完成', {
        event: 'ai_runtime.media_download.completed', ...identity,
        context: { outputIndex, attempt, byteLength: bytes.byteLength },
      })
      return { bytes, contentType: response.headers.get('content-type') ?? 'application/octet-stream' }
    } catch (error) {
      const retry = attempt < DOWNLOAD_ATTEMPTS && isTransientDownloadError(error)
      const details = {
        ...identity,
        context: { outputIndex, attempt, httpStatus: error instanceof MediaHttpError ? error.status : undefined },
        error,
      }
      if (!retry) {
        logger.error('生成结果下载失败', { event: 'ai_runtime.media_download.failed', ...details })
        if (error instanceof Error && error.name === 'AbortError') throw error
        const failure = new AiRuntimeError('media_download_failed', '结果已生成，但下载未完成。请重试获取结果。')
        failure.cause = error
        throw failure
      }
      logger.warn('生成结果下载中断，正在重试', { event: 'ai_runtime.media_download.retry', ...details })
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    }
  }
  throw new Error('Unreachable media download state')
}

export async function saveMediaFromUrl(url: string): Promise<string | undefined> {
  return (await saveMediaFromUrlTracked(url))?.filePath
}

export interface SavedMediaFile {
  filePath: string
  /** true 表示本次调用取得了一个可释放租约；文件也可能由同进程的更早调用创建。 */
  created: boolean
}

/** 下载并报告本次调用是否取得可释放租约，供上层做精确所有权回收。 */
export async function saveMediaFromUrlTracked(
  url: string,
  context: MediaDownloadContext = { requestId: `media-download-${randomUUID()}` },
): Promise<SavedMediaFile | undefined> {
  if (!url.trim()) {
    return undefined
  }

  const { bytes, contentType } = await downloadMedia(url, context)
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
