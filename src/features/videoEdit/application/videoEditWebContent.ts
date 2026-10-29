import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'

/**
 * 网页参数引用的网页文件夹的内容指纹（主进程散列并监视）：预渲染的窗口指纹带上它，网页文件改了，用到它的窗口就失效。
 * 第一次读到某个路径时还没有指纹，先按“未知”计入并去取，取到或之后内容变化时通知重算窗口。
 */
const logger = createLogger('features.videoEdit.webContent')
const hashes = new Map<string, string>()
const requested = new Set<string>()
const listeners = new Set<() => void>()
let watching = false

function update(path: string, hash: string): void {
  if (hashes.get(path) === hash) return
  hashes.set(path, hash)
  for (const listener of listeners) listener()
}

/** 这个网页路径当前的内容指纹；还没取到时为 'pending'，取到后经 `subscribeVideoEditWebContent` 通知。 */
export function videoEditWebContentIdentity(path: string): string {
  const hash = hashes.get(path)
  if (hash) return hash
  if (!requested.has(path)) {
    requested.add(path)
    const platform = getPlatform()
    if (!watching) { watching = true; platform.videoFrames.onWebContentChanged(change => { if (requested.has(change.path)) update(change.path, change.contentHash) }) }
    void platform.videoFrames.webContent(path).then(hash => update(path, hash), error => {
      // 读不了（文件夹不存在）：渲染这一段时会如实报错，窗口指纹按“不可用”计入，不反复重读。
      logger.warn('网页文件夹内容指纹读取失败', { event: 'video_edit.web_content.hash_failed', error, context: { path } })
      update(path, 'unavailable')
    })
  }
  return 'pending'
}

export function subscribeVideoEditWebContent(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
