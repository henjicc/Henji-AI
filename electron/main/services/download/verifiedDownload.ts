import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/*
 * 带校验的单文件下载（任务 4.11，通用模块）：只认清单里写死的大小与 SHA-256，从哪个源下载都一样校验，
 * 镜像被替换或传输损坏会被拒绝。
 *
 * - 写到同目录的 `<文件名>.part`，校验通过后原子改名为正式文件；正式文件要么不存在，要么一定完整。
 * - 断点续传：`.part` 已有内容时带 `Range` 请求，服务器回 206 就接着写（先把已有部分算进哈希），
 *   回 200 就从头写；取消或网络中断时保留 `.part`，下次继续。校验不符时删掉 `.part`，换源从头下载。
 * - 连接与数据都有超时：迟迟连不上或中途长时间没有数据都按网络失败处理，交给调用方换源。
 *
 * 用 Node 内置 fetch（undici）与 crypto，不引入下载库：需求只有单文件、顺序写、续传与校验。
 */

export interface VerifiedFileSpec {
  sizeBytes: number
  /** 小写十六进制 SHA-256。 */
  sha256: string
}

export type DownloadFailureKind = 'http_status' | 'network' | 'checksum' | 'disk' | 'cancelled'

export class DownloadFailure extends Error {
  constructor(
    readonly kind: DownloadFailureKind,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'DownloadFailure'
  }
}

export type DownloadFetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string>; redirect: 'follow' }) => Promise<Response>

export interface VerifiedDownloadOptions {
  url: string
  destination: string
  spec: VerifiedFileSpec
  fetch: DownloadFetch
  signal?: AbortSignal
  /** 已写入的字节数（含续传前已有部分）。 */
  onProgress?: (receivedBytes: number) => void
  /** 等待响应头的上限。 */
  connectTimeoutMs?: number
  /** 两次收到数据之间的最长间隔。 */
  stallTimeoutMs?: number
}

export interface VerifiedDownloadResult {
  /** 本次从网络实际收到的字节数。 */
  transferredBytes: number
  resumedFromBytes: number
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_STALL_TIMEOUT_MS = 30_000

export function partPathFor(destination: string): string {
  return `${destination}.part`
}

async function hashFile(filePath: string, hash = createHash('sha256')): Promise<ReturnType<typeof createHash>> {
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash
}

/** 文件大小与 SHA-256 都与清单一致才算完整。文件不存在返回 `missing`。 */
export async function verifyFile(filePath: string, spec: VerifiedFileSpec): Promise<'ok' | 'missing' | 'mismatch'> {
  let size: number
  try {
    size = (await fs.promises.stat(filePath)).size
  } catch {
    return 'missing'
  }
  if (size !== spec.sizeBytes) return 'mismatch'
  const digest = (await hashFile(filePath)).digest('hex')
  return digest === spec.sha256.toLowerCase() ? 'ok' : 'mismatch'
}

async function existingPartSize(partPath: string, limit: number): Promise<number> {
  try {
    const size = (await fs.promises.stat(partPath)).size
    if (size > 0 && size < limit) return size
    // 等于或超过完整大小的残留无法判断是否可信，从头下载。
    if (size >= limit) await fs.promises.rm(partPath, { force: true })
    return 0
  } catch {
    return 0
  }
}

function linkedController(signal: AbortSignal | undefined): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController()
  if (!signal) return { controller, dispose: () => undefined }
  if (signal.aborted) controller.abort(signal.reason)
  const onAbort = (): void => controller.abort(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  return { controller, dispose: () => signal.removeEventListener('abort', onAbort) }
}

export async function downloadVerifiedFile(options: VerifiedDownloadOptions): Promise<VerifiedDownloadResult> {
  const { spec, destination } = options
  const partPath = partPathFor(destination)
  try {
    await fs.promises.mkdir(path.dirname(destination), { recursive: true })
  } catch (error) {
    throw new DownloadFailure('disk', `无法创建目录：${(error as Error).message}`)
  }

  const resumeFrom = await existingPartSize(partPath, spec.sizeBytes)
  const { controller, dispose } = linkedController(options.signal)
  const cancelled = (): boolean => options.signal?.aborted === true
  let timer: ReturnType<typeof setTimeout> | null = null
  const arm = (ms: number): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => controller.abort(new Error('timeout')), ms)
  }

  try {
    arm(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS)
    let response: Response
    try {
      response = await options.fetch(options.url, {
        signal: controller.signal,
        headers: resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {},
        redirect: 'follow',
      })
    } catch (error) {
      if (cancelled()) throw new DownloadFailure('cancelled', '下载已取消')
      throw new DownloadFailure('network', `连接失败：${(error as Error).message}`)
    }

    let startAt = 0
    if (response.status === 206 && resumeFrom > 0) startAt = resumeFrom
    else if (response.status === 416 && resumeFrom > 0) {
      // 服务器不接受这个续传位置：丢掉残留，交给调用方重试（下一次从头开始）。
      await fs.promises.rm(partPath, { force: true })
      throw new DownloadFailure('network', '续传位置无效，已清除残留')
    } else if (response.status !== 200) {
      throw new DownloadFailure('http_status', `HTTP ${response.status}`, response.status)
    }
    if (!response.body) throw new DownloadFailure('network', '响应没有内容')

    const hash = startAt > 0 ? await hashFile(partPath) : createHash('sha256')
    let handle: fs.promises.FileHandle
    try {
      handle = await fs.promises.open(partPath, startAt > 0 ? 'a' : 'w')
    } catch (error) {
      throw new DownloadFailure('disk', `无法写入临时文件：${(error as Error).message}`)
    }

    let received = startAt
    const stallMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
    try {
      const reader = response.body.getReader()
      // 取消与超时都要让正在等待的 read() 立即结束，不依赖响应流自己响应中止信号。
      const stopReading = (): void => { void reader.cancel().catch(() => undefined) }
      if (controller.signal.aborted) stopReading()
      else controller.signal.addEventListener('abort', stopReading, { once: true })
      arm(stallMs)
      for (;;) {
        let chunk: Awaited<ReturnType<typeof reader.read>>
        try {
          chunk = await reader.read()
        } catch (error) {
          if (cancelled()) throw new DownloadFailure('cancelled', '下载已取消')
          throw new DownloadFailure('network', `传输中断：${(error as Error).message}`)
        }
        if (chunk.done) {
          if (cancelled()) throw new DownloadFailure('cancelled', '下载已取消')
          if (controller.signal.aborted) throw new DownloadFailure('network', '长时间没有收到数据')
          break
        }
        arm(stallMs)
        received += chunk.value.byteLength
        if (received > spec.sizeBytes) {
          controller.abort()
          await handle.close().catch(() => undefined)
          await fs.promises.rm(partPath, { force: true })
          throw new DownloadFailure('checksum', '文件比清单登记的大，来源内容不一致')
        }
        hash.update(chunk.value)
        try {
          await handle.write(chunk.value)
        } catch (error) {
          throw new DownloadFailure('disk', `写入失败：${(error as Error).message}`)
        }
        options.onProgress?.(received)
      }
    } finally {
      await handle.close().catch(() => undefined)
    }

    if (received !== spec.sizeBytes) {
      throw new DownloadFailure('network', `文件不完整（${received}/${spec.sizeBytes} 字节）`)
    }
    const digest = hash.digest('hex')
    if (digest !== spec.sha256.toLowerCase()) {
      await fs.promises.rm(partPath, { force: true })
      throw new DownloadFailure('checksum', 'SHA-256 与清单不一致')
    }
    try {
      await fs.promises.rename(partPath, destination)
    } catch (error) {
      throw new DownloadFailure('disk', `无法完成文件：${(error as Error).message}`)
    }
    return { transferredBytes: received - startAt, resumedFromBytes: startAt }
  } finally {
    if (timer) clearTimeout(timer)
    dispose()
  }
}
