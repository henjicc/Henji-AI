import fs from 'node:fs'
import type { MainLogger } from '../logging/main-logger'
import { webSourceContentHash } from './site'

/** 文件改动后等这么久没有新的改动再重新散列（编辑器保存、构建输出常是一串连续写入）。 */
const SETTLE_MS = 300
/** 监视中断或重新散列失败后，隔这么久再试（文件夹可能正被构建工具整个替换）。 */
const RETRY_MS = 2_000

interface WatchedRoot {
  /** 打开着的页面数；为 0 时停止监视、释放条目。 */
  holders: number
  hash: Promise<string>
  watcher?: fs.FSWatcher
  timer?: ReturnType<typeof setTimeout>
  /** 监视失败、重新散列失败各只记一次，恢复后清掉。 */
  watchWarned?: boolean
  hashWarned?: boolean
}

/**
 * 网页文件夹的内容指纹。有页面打开时监视文件夹：改动后重新散列，指纹变了就通知（打开着的页面重新载入，渲染层让依赖它的
 * 预渲染失效）；页面全关后释放监视。没有页面时按需现算（各文件按大小与修改时间记住散列，没变的不重读）。
 */
export class WebSourceContent {
  private readonly roots = new Map<string, WatchedRoot>()
  /** 渲染层查询过的路径（按文件夹）：内容变化按这些路径通知。 */
  private readonly requested = new Map<string, Set<string>>()

  constructor(private readonly onChanged: (root: string, hash: string, paths: string[]) => void, private readonly logger: Pick<MainLogger, 'info' | 'warn'>) {}

  hash(root: string, requestedPath?: string): Promise<string> {
    if (requestedPath) { const paths = this.requested.get(root) ?? new Set(); paths.add(requestedPath); this.requested.set(root, paths) }
    return this.roots.get(root)?.hash ?? webSourceContentHash(root)
  }

  /** 页面打开时持有：开始监视并返回当前指纹。散列失败时不留下监视。 */
  async retain(root: string): Promise<string> {
    let entry = this.roots.get(root)
    if (!entry) {
      entry = { holders: 0, hash: webSourceContentHash(root) }
      this.roots.set(root, entry)
      this.watch(root, entry)
    }
    entry.holders++
    try { return await entry.hash } catch (error) { this.release(root); throw error }
  }

  release(root: string): void {
    const entry = this.roots.get(root)
    if (!entry || --entry.holders > 0) return
    this.roots.delete(root)
    clearTimeout(entry.timer)
    entry.watcher?.close()
  }

  private watch(root: string, entry: WatchedRoot): void {
    if (this.roots.get(root) !== entry) return
    try {
      const watcher = fs.watch(root, { recursive: true }, () => this.schedule(root, entry, SETTLE_MS))
      entry.watcher = watcher
      entry.watchWarned = false
      watcher.on('error', error => {
        if (!entry.watchWarned) this.logger.warn('网页文件夹监视中断，稍后重新监视', { event: 'web_source.content.watch_failed', error, context: { root } })
        entry.watchWarned = true
        watcher.close()
        if (entry.watcher === watcher) entry.watcher = undefined
        // 恢复监视后先重新散列一次，补上中断期间的改动。
        clearTimeout(entry.timer)
        entry.timer = setTimeout(() => { this.watch(root, entry); void this.rehash(root, entry) }, RETRY_MS)
      })
      watcher.unref?.()
    } catch (error) {
      if (!entry.watchWarned) this.logger.warn('无法监视网页文件夹，稍后重试', { event: 'web_source.content.watch_failed', error, context: { root } })
      entry.watchWarned = true
      clearTimeout(entry.timer)
      entry.timer = setTimeout(() => this.watch(root, entry), RETRY_MS)
    }
  }

  private schedule(root: string, entry: WatchedRoot, delay: number): void {
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => void this.rehash(root, entry), delay)
  }

  private async rehash(root: string, entry: WatchedRoot): Promise<void> {
    if (this.roots.get(root) !== entry) return
    const previous = await entry.hash.catch(() => undefined)
    try {
      const hash = await webSourceContentHash(root)
      if (this.roots.get(root) !== entry) return
      entry.hash = Promise.resolve(hash)
      entry.hashWarned = false
      if (hash === previous) return
      this.logger.info('网页文件夹内容已变化', { event: 'web_source.content.changed', context: { root, hash } })
      this.onChanged(root, hash, [...this.requested.get(root) ?? []])
    } catch (error) {
      // 改动进行到一半（文件夹被整个替换）时会读失败：保留上一次的指纹，稍后再散列。
      if (!entry.hashWarned) this.logger.warn('网页文件夹重新散列失败，稍后重试', { event: 'web_source.content.hash_failed', error, context: { root } })
      entry.hashWarned = true
      if (this.roots.get(root) === entry) this.schedule(root, entry, RETRY_MS)
    }
  }

  dispose(): void {
    for (const entry of this.roots.values()) { clearTimeout(entry.timer); entry.watcher?.close() }
    this.roots.clear()
  }
}
