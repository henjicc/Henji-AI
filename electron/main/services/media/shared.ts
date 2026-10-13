import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import { getUploadsDir } from '../image/path-utils'
import { normalizeLocalSource } from '../image/source'
import { registerOwnedMedia } from '../media-recycle/queue'
import { createMainLogger } from '../logging'

const MAX_BUFFER_BYTES = 32 * 1024 * 1024
const logger = createMainLogger('main.media.shared')
const MAX_REMOTE_BYTES = 4 * 1024 * 1024 * 1024
const REMOTE_TIMEOUT_MS = 10 * 60 * 1000
interface RemoteMediaLimits { maxBytes?: number; timeoutMs?: number }

/**
 * 执行外部二进制并以 Buffer（而非字符串）接收 stdout，供需要读取二进制输出
 * （截帧 PNG/webp、PCM 音频采样等）的调用方使用。
 */
export function execFileAsyncBuffer(binaryPath: string, args: string[], options: { signal?: AbortSignal; timeout?: number } = {}): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, args, { maxBuffer: MAX_BUFFER_BYTES, encoding: 'buffer', ...options }, (error, stdout, stderr) => {
      if (error) {
        if (options.signal?.aborted) { reject(options.signal.reason); return }
        reject(new Error(`${path.basename(binaryPath)} failed: ${error.message}\n${stderr.toString()}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

/**
 * 本地路径 / henji-media:// URL 直接校验存在性；http(s) 远程地址先下载到临时 Uploads 目录，
 * 供 ffmpeg/ffprobe 等只能处理本地文件的命令行工具使用。视频/音频共用同一套解析逻辑。
 */
export async function resolveLocalMediaPath(source: string, signal?: AbortSignal, limits: RemoteMediaLimits = {}): Promise<string> {
  signal?.throwIfAborted()
  const trimmed = source.trim()
  if (!trimmed) throw new Error('Media source is empty')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return await downloadToTempFile(trimmed, signal, limits)
  }
  const localPath = normalizeLocalSource(trimmed)
  await fs.promises.access(localPath, fs.constants.R_OK)
  signal?.throwIfAborted()
  return localPath
}

async function downloadToTempFile(url: string, signal: AbortSignal | undefined, limits: RemoteMediaLimits): Promise<string> {
  const maxBytes = limits.maxBytes ?? MAX_REMOTE_BYTES
  const timeoutMs = limits.timeoutMs ?? REMOTE_TIMEOUT_MS
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_REMOTE_BYTES || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REMOTE_TIMEOUT_MS) throw new Error('远程媒体下载预算无效。')
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const ext = path.extname(new URL(url).pathname) || '.bin'
  const targetPath = path.join(getUploadsDir(), `${crypto.randomUUID()}${ext}`)
  const requestId = crypto.randomUUID()
  let receivedBytes = 0
  logger.info('开始下载远程媒体', { event: 'media.download.start', requestId, context: { maxBytes, timeoutMs } })
  try {
    const response = await fetch(url, { signal: combined })
    combined.throwIfAborted()
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new Error(`Remote media request failed with status ${response.status}`)
    }
    const contentLength = Number(response.headers.get('content-length'))
    if (contentLength > maxBytes) {
      await response.body.cancel()
      throw new Error(`远程媒体超过下载上限（${maxBytes} 字节）。`)
    }
    const budget = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.byteLength
      callback(receivedBytes > maxBytes ? new Error(`远程媒体超过下载上限（${maxBytes} 字节）。`) : null, chunk)
    } })
    // 主进程 fetch 返回 Node WebStream；双工程编译时 DOM 的旧声明缺少异步迭代成员。
    const sourceStream = response.body as unknown as NodeReadableStream<Uint8Array>
    await pipeline(Readable.fromWeb(sourceStream), budget, fs.createWriteStream(targetPath, { flags: 'wx' }), { signal: combined })
    combined.throwIfAborted()
    await registerOwnedMedia(targetPath)
    logger.info('远程媒体下载完成', { event: 'media.download.completed', requestId, context: { receivedBytes } })
  } catch (error) {
    logger.warn('远程媒体下载未完成', { event: 'media.download.failed', requestId, error, context: { receivedBytes } })
    // media-recycle-allow: failed unpublished download, no caller has received this path.
    await fs.promises.rm(targetPath, { force: true }).catch(cleanupError => logger.warn('远程媒体临时文件清理失败', { event: 'media.download.cleanup_failed', requestId, error: cleanupError }))
    throw combined.aborted ? combined.reason : error
  }
  return targetPath
}
