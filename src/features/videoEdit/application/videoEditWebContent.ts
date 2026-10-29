import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import { VideoEditCodeMetadataPending } from './videoEditCodeState'

/**
 * 网页参数引用的网页文件夹的内容指纹（主进程散列）：预渲染的窗口指纹带上它，网页文件改了，用到它的窗口就失效。
 * 第一次读到某个路径时抛出 VideoEditWebContentPending，调用方等它读好（读好以前的指纹不能拿来回收或渲染文件，
 * 与代码声明读取中同一处理）。读过的路径隔 RETRY_MS 在后台复核一次（主进程只在有页面打开时才监视文件夹）；复核读不出来
 * （构建工具正整个替换文件夹）时沿用上一次的指纹，不让一时的读取失败把预渲染当成过期。从没读出来过的路径按“不可用”计入，
 * 之后同样每隔 RETRY_MS 重读。
 */
const RETRY_MS = 10_000
const logger = createLogger('features.videoEdit.webContent')
const hashes = new Map<string, { hash: string; at: number }>()
const pending = new Map<string, Promise<void>>()
const unavailable = new Map<string, number>()
/** 读取失败已记过日志的路径：同一路径连续失败只记一次，读出来后清掉。 */
const failing = new Set<string>()
const listeners = new Set<() => void>()
let watching = false

/** 网页内容指纹还在读取：指纹与读好后的不同，不能拿来回收或渲染预览文件。 */
export class VideoEditWebContentPending extends VideoEditCodeMetadataPending {
  constructor(ready: Promise<void>) { super(ready); this.message = '正在读取网页内容…' }
}

function update(path: string, hash: string): void {
  const changed = hashes.get(path)?.hash !== hash
  hashes.set(path, { hash, at: performance.now() })
  unavailable.delete(path)
  failing.delete(path)
  if (changed) for (const listener of listeners) listener()
}

function read(path: string): Promise<void> {
  const running = pending.get(path)
  if (running) return running
  const platform = getPlatform()
  if (!watching) { watching = true; platform.videoFrames.onWebContentChanged(change => { if (hashes.has(change.path) || unavailable.has(change.path)) update(change.path, change.contentHash) }) }
  const next = platform.videoFrames.webContent(path).then(hash => update(path, hash), error => {
    if (!failing.has(path)) logger.warn('网页文件夹内容指纹读取失败', { event: 'video_edit.web_content.hash_failed', error, context: { path, known: hashes.has(path) } })
    failing.add(path)
    if (!hashes.has(path)) unavailable.set(path, performance.now())
  }).finally(() => pending.delete(path))
  pending.set(path, next)
  return next
}

/** 这个网页路径当前的内容指纹；还没读过时抛出 VideoEditWebContentPending，从没读出来过时为 'unavailable'。 */
export function videoEditWebContentIdentity(path: string): string {
  const known = hashes.get(path)
  if (known) {
    if (performance.now() - known.at >= RETRY_MS) { known.at = performance.now(); void read(path) }
    return known.hash
  }
  const failedAt = unavailable.get(path)
  if (failedAt !== undefined) {
    if (performance.now() - failedAt >= RETRY_MS) { unavailable.set(path, performance.now()); void read(path) }
    return 'unavailable'
  }
  throw new VideoEditWebContentPending(read(path))
}

export function subscribeVideoEditWebContent(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
