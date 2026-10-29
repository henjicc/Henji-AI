import fs from 'node:fs'
import type { MainLogger } from '../logging/main-logger'
import { webSourceContentHash } from './site'

/** 文件改动后等这么久没有新的改动再重新散列（编辑器保存、构建输出常是一串连续写入）。 */
const SETTLE_MS = 300

interface WatchedRoot {
  hash: Promise<string>
  /** 渲染层按哪些路径查询过这个文件夹（变化按这些路径通知）。 */
  paths: Set<string>
  watcher?: fs.FSWatcher
  timer?: ReturnType<typeof setTimeout>
}

/**
 * 网页文件夹的内容指纹：第一次用到时散列并开始监视，文件变化后重新散列，指纹变了就通知
 * （打开着的页面重新载入，渲染层让依赖它的预渲染失效）。
 */
export class WebSourceContent {
  private readonly roots = new Map<string, WatchedRoot>()

  constructor(private readonly onChanged: (root: string, hash: string, paths: string[]) => void, private readonly logger: Pick<MainLogger, 'info' | 'warn'>) {}

  hash(root: string, requestedPath?: string): Promise<string> {
    let entry = this.roots.get(root)
    if (!entry) {
      entry = { hash: webSourceContentHash(root), paths: new Set() }
      this.roots.set(root, entry)
      const current = entry
      current.hash.catch(() => { if (this.roots.get(root) === current) this.roots.delete(root) })
      this.watch(root, current)
    }
    if (requestedPath) entry.paths.add(requestedPath)
    return entry.hash
  }

  private watch(root: string, entry: WatchedRoot): void {
    try {
      entry.watcher = fs.watch(root, { recursive: true }, () => {
        clearTimeout(entry.timer)
        entry.timer = setTimeout(() => void this.rehash(root, entry), SETTLE_MS)
      })
      entry.watcher.on('error', error => {
        this.logger.warn('网页文件夹监视中断，之后的改动要重新打开工程才生效', { event: 'web_source.content.watch_failed', error, context: { root } })
        entry.watcher?.close(); entry.watcher = undefined
      })
      entry.watcher.unref?.()
    } catch (error) {
      this.logger.warn('无法监视网页文件夹，之后的改动要重新打开工程才生效', { event: 'web_source.content.watch_failed', error, context: { root } })
    }
  }

  private async rehash(root: string, entry: WatchedRoot): Promise<void> {
    if (this.roots.get(root) !== entry) return
    const previous = await entry.hash.catch(() => undefined)
    const next = webSourceContentHash(root)
    entry.hash = next
    try {
      const hash = await next
      if (hash === previous || this.roots.get(root) !== entry) return
      this.logger.info('网页文件夹内容已变化', { event: 'web_source.content.changed', context: { root, hash } })
      this.onChanged(root, hash, [...entry.paths])
    } catch (error) {
      this.logger.warn('网页文件夹重新散列失败', { event: 'web_source.content.hash_failed', error, context: { root } })
    }
  }

  dispose(): void {
    for (const entry of this.roots.values()) { clearTimeout(entry.timer); entry.watcher?.close() }
    this.roots.clear()
  }
}
